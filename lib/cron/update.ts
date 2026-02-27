/**
 * update.ts — Daily pipeline orchestrator
 *
 * Called by /api/cron/update route handler.
 * Returns a result object — all side effects are DB writes.
 *
 * Run order:
 *   1. Idempotency check (early return if today already succeeded)
 *   2. Load countries + normalization_params from DB
 *   3. Fetch shared daily data: US10Y, crypto
 *   4. Per country: fetch FX, compute stress_score, upsert
 *   5. If first day of month: fetch inflation + sovereign + reserves
 *   6. Write pipeline_log row
 *
 * Complexity: O(n countries) — never touches historical rows.
 */
import { supabase } from '../supabase'
import {
    fetchFxDay,
    fetchCryptoDay,
    fetchUs10yDay,
    fetchInflationLatest,
    fetchSovereignFred,
    fetchSovereignImf,
    fetchReservesImf,
    fetchStablecoinPremium,
    FRED_SOVEREIGN_SERIES,
} from './fetchers'
import { computeStressScore, computeComponentScores, type RawMetrics, type NormParam, type MetricName } from './compute'

export interface PipelineResult {
    run_date: string
    status: 'success' | 'partial' | 'error'
    skipped?: boolean     // idempotency: today already ran
    countries_updated: number
    duration_ms: number
    detail: Record<string, unknown>
    errors: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().split('T')[0]
const isFirstDayOfMonth = () => new Date().getUTCDate() === 1

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runDailyUpdate(): Promise<PipelineResult> {
    const startMs = Date.now()
    const run_date = today()
    const errors: string[] = []
    const detail: Record<string, unknown> = {}

    // ── 1. Idempotency guard ────────────────────────────────────────────────────
    // If today already has a 'success' run, skip entirely.
    const { data: existingLog } = await supabase
        .from('pipeline_log')
        .select('id')
        .eq('run_date', run_date)
        .eq('status', 'success')
        .maybeSingle()

    if (existingLog) {
        return {
            run_date,
            status: 'success',
            skipped: true,
            countries_updated: 0,
            duration_ms: Date.now() - startMs,
            detail: { reason: 'already ran successfully today' },
            errors: [],
        }
    }

    // ── 2. Load countries ───────────────────────────────────────────────────────
    const { data: countries, error: countryErr } = await supabase
        .from('countries')
        .select('id, iso2, name')
    if (countryErr || !countries) {
        const msg = `Failed to load countries: ${countryErr?.message}`
        return buildError(run_date, msg, startMs)
    }

    // ── 3. Load normalization params (indexed by country_id → metric_name → param) ─
    const { data: normRows, error: normErr } = await supabase
        .from('normalization_params')
        .select('country_id, metric_name, min_val, max_val')
    if (normErr) {
        const msg = `Failed to load normalization_params: ${normErr.message}`
        return buildError(run_date, msg, startMs)
    }

    // Build lookup: countryId → metric_name → NormParam
    const normByCountry = new Map<number, NormParam[]>()
    for (const row of normRows ?? []) {
        const existing = normByCountry.get(row.country_id) ?? []
        existing.push({ metric_name: row.metric_name as MetricName, min_val: row.min_val, max_val: row.max_val })
        normByCountry.set(row.country_id, existing)
    }

    // ── 4. Fetch shared daily data ──────────────────────────────────────────────
    console.log(`[cron] ${run_date} — fetching shared daily data...`)
    const [cryptoDay, us10y] = await Promise.all([fetchCryptoDay(), fetchUs10yDay()])

    if (!cryptoDay) {
        errors.push('crypto fetch failed')
        detail['crypto'] = 'failed'
    }
    if (!us10y) {
        errors.push('us_10y fetch failed')
        detail['us_10y'] = 'failed'
    }

    const isMonthly = isFirstDayOfMonth()
    if (isMonthly) {
        console.log('[cron] First day of month — will fetch inflation, sovereign, reserves')
        detail['monthly_refresh'] = true
    }

    // ── 5. Per-country loop ─────────────────────────────────────────────────────
    let countries_updated = 0

    for (const country of countries) {
        const iso2 = country.iso2
        const countryId = country.id
        const normParams = normByCountry.get(countryId) ?? []
        const countryFlags: Record<string, unknown> = {}
        const missing: string[] = []

        console.log(`\n[cron] Processing ${iso2}...`)

        // ── 5a. Fetch FX (always daily) ──────────────────────────────────────────
        const fxDay = await fetchFxDay(iso2)
        if (!fxDay) {
            errors.push(`${iso2}: fx fetch failed`)
            missing.push('fx_vol')
        }

        // ── 5b. Pull last-known values for monthly metrics from DB ─────────────
        // Each monthly column is queried independently — the most recent row may
        // have NULL for inflation/sovereign/reserves if it was a FX-only daily upsert.
        // This ensures correct forward-fill even on non-monthly cron runs.
        const [lastInflRow, lastSovRow, lastResRow, lastStablecoinRow] = await Promise.all([
            supabase
                .from('metrics_daily')
                .select('inflation_yoy, inflation')
                .eq('country_id', countryId)
                .not('inflation_yoy', 'is', null)
                .order('date', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase
                .from('metrics_daily')
                .select('sovereign_yield, risk_spread')
                .eq('country_id', countryId)
                .not('risk_spread', 'is', null)
                .order('date', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase
                .from('metrics_daily')
                .select('reserves_level, reserves_change')
                .eq('country_id', countryId)
                .not('reserves_level', 'is', null)
                .order('date', { ascending: false })
                .limit(1)
                .maybeSingle(),
            // Stablecoin premium forward-fill (AR only, but query is harmless for others)
            supabase
                .from('metrics_daily')
                .select('stablecoin_premium')
                .eq('country_id', countryId)
                .not('stablecoin_premium', 'is', null)
                .order('date', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ])

        // ── 5b2. Fetch stablecoin premium (daily, AR only) ────────────────────────
        let stablecoin_premium: number | null = lastStablecoinRow.data?.stablecoin_premium ?? null
        if (fxDay) {
            const stablecoinResult = await fetchStablecoinPremium(iso2, fxDay.close)
            if (stablecoinResult) {
                stablecoin_premium = stablecoinResult.premium
                countryFlags['stablecoin_sources'] = stablecoinResult.source_count
            } else if (iso2 === 'AR' && stablecoin_premium !== null) {
                // Forward-fill: CriptoYa failed but we have a previous value
                countryFlags['stablecoin_premium'] = 'forward_filled'
            } else if (iso2 === 'AR') {
                missing.push('stablecoin_premium')
                countryFlags['stablecoin_premium'] = 'fetch_failed'
            }
        }

        // ── 5c. Fetch FX volatility (30d rolling) from recent closes ─────────────
        // For the cron we compute vol from the last 31 fx_close values in DB
        let fx_vol: number | null = null
        if (fxDay) {
            const { data: recentFx } = await supabase
                .from('metrics_daily')
                .select('fx_close')
                .eq('country_id', countryId)
                .not('fx_close', 'is', null)
                .order('date', { ascending: false })
                .limit(30)

            const closes = (recentFx ?? []).map((r: any) => r.fx_close as number)
            closes.unshift(fxDay.close) // prepend today's close

            if (closes.length >= 2) {
                // log return std dev
                const logReturns = closes
                    .slice(0, -1)
                    .map((close, i) => Math.log(close / closes[i + 1]))
                const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length
                const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1)
                fx_vol = Math.sqrt(variance)
            }
        }

        // ── 5d. Monthly fetches — forward-fill last-known values as baseline ──────
        // These are the values that will be upserted even on non-monthly runs,
        // keeping every daily row complete without re-fetching APIs.
        let inflation_yoy: number | null = lastInflRow.data?.inflation_yoy ?? null
        let inflation: number | null = lastInflRow.data?.inflation ?? null
        let sovereign_yield: number | null = lastSovRow.data?.sovereign_yield ?? null
        let risk_spread: number | null = lastSovRow.data?.risk_spread ?? null
        let reserves_level: number | null = lastResRow.data?.reserves_level ?? null
        let reserves_change: number | null = lastResRow.data?.reserves_change ?? null

        if (isMonthly) {
            // Inflation — fetch new annual YoY, compute acceleration vs last stored value
            const inflResult = await fetchInflationLatest(iso2)
            if (inflResult) {
                const prevYoy = lastInflRow.data?.inflation_yoy ?? null
                inflation_yoy = inflResult.value
                inflation = prevYoy !== null ? inflResult.value - prevYoy : null
            } else {
                missing.push('inflation')
                countryFlags['inflation_source'] = 'fetch_failed'
            }

            // Sovereign yield
            let newYield: number | null = null
            if (FRED_SOVEREIGN_SERIES[iso2]) {
                const r = await fetchSovereignFred(iso2)
                newYield = r?.yield ?? null
            } else {
                const r = await fetchSovereignImf(iso2)
                if (r) {
                    newYield = r.yield
                } else {
                    missing.push('risk_spread')
                    countryFlags['sovereign_source'] = 'imf_unavailable'
                }
            }

            if (newYield !== null) {
                sovereign_yield = newYield
                risk_spread = us10y !== null ? newYield - us10y : null
            }

            // Reserves
            const resResult = await fetchReservesImf(iso2)
            if (resResult) {
                // 90-day % change: compare to the reserves_level from ~90 days ago
                const { data: oldReserves } = await supabase
                    .from('metrics_daily')
                    .select('reserves_level')
                    .eq('country_id', countryId)
                    .not('reserves_level', 'is', null)
                    .gte('date', getPriorDate(100))
                    .lte('date', getPriorDate(80))
                    .order('date', { ascending: false })
                    .limit(1)
                    .maybeSingle()

                const oldLevel = oldReserves?.reserves_level ?? null
                reserves_level = resResult.level
                reserves_change = oldLevel ? ((resResult.level - oldLevel) / oldLevel) * 100 : null
            } else {
                missing.push('reserves_change')
                countryFlags['reserves_source'] = 'imf_unavailable'
            }
        }

        // ── 5e. Assemble current metrics ─────────────────────────────────────────
        const metrics: RawMetrics = {
            fx_vol: fx_vol,
            inflation: inflation,
            risk_spread: risk_spread,
            crypto_ratio: cryptoDay?.crypto_ratio ?? null,
            reserves_change: reserves_change,
            stablecoin_premium: stablecoin_premium,
        }

        // ── 5f. Compute stress score ──────────────────────────────────────────────
        const stressResult = computeStressScore(metrics, normParams)

        if (missing.length > 0) {
            countryFlags['partial'] = true
            countryFlags['missing'] = missing
        }

        const finalFlags = { ...countryFlags, ...(stressResult?.data_flags ?? {}) }

        // ── 5g. Upsert row ───────────────────────────────────────────────────────
        const upsertRow: Record<string, unknown> = {
            country_id: countryId,
            date: fxDay?.date ?? run_date,
            // Raw values
            ...(fxDay && { fx_close: fxDay.close }),
            ...(fxDay?.arg_blue_gap !== undefined && { arg_blue_gap: fxDay.arg_blue_gap }),
            ...(inflation_yoy !== null && { inflation_yoy }),
            ...(sovereign_yield !== null && { sovereign_yield }),
            ...(us10y !== null && { us_10y: us10y }),
            ...(reserves_level !== null && { reserves_level }),
            ...(stablecoin_premium !== null && { stablecoin_premium }),
            // Derived
            ...(fx_vol !== null && { fx_vol }),
            ...(inflation !== null && { inflation }),
            ...(risk_spread !== null && { risk_spread }),
            ...(cryptoDay && { crypto_ratio: cryptoDay.crypto_ratio }),
            ...(reserves_change !== null && { reserves_change }),
            // Score
            ...(stressResult && { stress_score: stressResult.stress_score }),
            // Flags
            data_flags: finalFlags,
            updated_at: new Date().toISOString(),
        }

        const { error: upsertErr } = await supabase
            .from('metrics_daily')
            .upsert(upsertRow, { onConflict: 'country_id,date' })

        if (upsertErr) {
            errors.push(`${iso2}: upsert failed — ${upsertErr.message}`)
        } else {
            countries_updated++
            detail[iso2] = {
                stress_score: stressResult?.stress_score ?? null,
                available_weight: stressResult?.available_weight ?? null,
                partial: finalFlags['partial'] ?? false,
                missing,
            }
            console.log(`  ✅ ${iso2} — score: ${stressResult?.stress_score ?? 'n/a'} | weight: ${stressResult?.available_weight ?? 'n/a'}`)
        }
    }

    // ── 6. Write pipeline_log ───────────────────────────────────────────────────
    const duration_ms = Date.now() - startMs
    const status: PipelineResult['status'] =
        errors.length === 0 ? 'success' :
            countries_updated > 0 ? 'partial' : 'error'

    await supabase.from('pipeline_log').insert({
        run_date,
        status,
        detail: { ...detail, errors },
        duration_ms,
    })

    console.log(`\n[cron] Done — ${status} | ${countries_updated} countries | ${duration_ms}ms`)

    return { run_date, status, countries_updated, duration_ms, detail, errors }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildError(run_date: string, msg: string, startMs: number): PipelineResult {
    console.error(`[cron] Fatal: ${msg}`)
    return {
        run_date,
        status: 'error',
        countries_updated: 0,
        duration_ms: Date.now() - startMs,
        detail: { fatal: msg },
        errors: [msg],
    }
}

function getPriorDate(days: number): string {
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString().split('T')[0]
}
