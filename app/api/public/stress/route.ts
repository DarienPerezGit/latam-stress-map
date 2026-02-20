/**
 * /api/public/stress — Public stress score endpoint
 *
 * Returns the latest stress score per country with:
 *   - stress_score (0–100)
 *   - per-component normalized scores (0–100 | null)
 *   - rank (1 = most stressed)
 *   - delta_7d, delta_30d (score change vs 7 and 30 days ago)
 *   - partial flag, missing components
 *
 * Auth: None (public read)
 * Cache: Vercel edge — s-maxage=3600, stale-while-revalidate=600
 *
 * Example response:
 * [
 *   {
 *     "country": "Argentina", "iso2": "AR",
 *     "date": "2026-02-20", "stress_score": 72.4, "rank": 1,
 *     "delta_7d": 4.2, "delta_30d": -1.1,
 *     "components": { "fx_vol": 81, "inflation": 90, "risk_spread": null, ... },
 *     "partial": true, "missing": ["risk_spread"]
 *   }
 * ]
 */
import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'
import { computeComponentScores, type RawMetrics, type NormParam, type MetricName } from '../../../../lib/cron/compute'

export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        // ── 1. Load countries ───────────────────────────────────────────────────
        const { data: countries, error: countryErr } = await supabase
            .from('countries')
            .select('id, name, iso2')
        if (countryErr) throw countryErr

        // ── 2. Load normalization params ────────────────────────────────────────
        const { data: normRows, error: normErr } = await supabase
            .from('normalization_params')
            .select('country_id, metric_name, min_val, max_val')
        if (normErr) throw normErr

        const normByCountry = new Map<number, NormParam[]>()
        for (const row of normRows ?? []) {
            const existing = normByCountry.get(row.country_id) ?? []
            existing.push({ metric_name: row.metric_name as MetricName, min_val: row.min_val, max_val: row.max_val })
            normByCountry.set(row.country_id, existing)
        }

        // ── 3. Latest row per country ───────────────────────────────────────────
        // Subquery pattern: for each country, get the most recent date with a stress_score.
        const results = []

        for (const country of countries ?? []) {
            // Latest row
            const { data: latest } = await supabase
                .from('metrics_daily')
                .select('date, stress_score, fx_vol, inflation, risk_spread, crypto_ratio, reserves_change, data_flags')
                .eq('country_id', country.id)
                .not('stress_score', 'is', null)
                .order('date', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (!latest) continue

            // 7-day-ago row
            const { data: row7d } = await supabase
                .from('metrics_daily')
                .select('stress_score')
                .eq('country_id', country.id)
                .not('stress_score', 'is', null)
                .lte('date', getOffsetDate(latest.date, -7))
                .order('date', { ascending: false })
                .limit(1)
                .maybeSingle()

            // 30-day-ago row
            const { data: row30d } = await supabase
                .from('metrics_daily')
                .select('stress_score')
                .eq('country_id', country.id)
                .not('stress_score', 'is', null)
                .lte('date', getOffsetDate(latest.date, -30))
                .order('date', { ascending: false })
                .limit(1)
                .maybeSingle()

            const normParams = normByCountry.get(country.id) ?? []
            const metrics: RawMetrics = {
                fx_vol: latest.fx_vol,
                inflation: latest.inflation,
                risk_spread: latest.risk_spread,
                crypto_ratio: latest.crypto_ratio,
                reserves_change: latest.reserves_change,
            }
            const components = computeComponentScores(metrics, normParams)
            const flags = (latest.data_flags ?? {}) as Record<string, unknown>

            results.push({
                country: country.name,
                iso2: country.iso2,
                date: latest.date,
                stress_score: latest.stress_score,
                rank: 0,    // filled after sort
                delta_7d: row7d?.stress_score != null ? round1(latest.stress_score - row7d.stress_score) : null,
                delta_30d: row30d?.stress_score != null ? round1(latest.stress_score - row30d.stress_score) : null,
                components,
                partial: flags['partial'] ?? false,
                missing: (flags['missing'] as string[]) ?? [],
                low_confidence: flags['low_confidence'] ?? false,
            })
        }

        // ── 4. Sort by stress_score desc, assign rank ───────────────────────────
        results.sort((a, b) => b.stress_score - a.stress_score)
        results.forEach((r, i) => { r.rank = i + 1 })

        return new Response(JSON.stringify(results), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
            },
        })
    } catch (err: any) {
        console.error('[/api/public/stress] Error:', err)
        return NextResponse.json(
            { error: 'Internal server error', message: err.message },
            { status: 500 }
        )
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOffsetDate(dateStr: string, offsetDays: number): string {
    const d = new Date(dateStr)
    d.setDate(d.getDate() + offsetDays)
    return d.toISOString().split('T')[0]
}

function round1(n: number): number {
    return Math.round(n * 10) / 10
}
