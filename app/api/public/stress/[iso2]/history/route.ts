/**
 * /api/public/stress/[iso2]/history — 30-day stress history for a country
 *
 * Returns chronological array (oldest → newest) with:
 *   - date, stress_score, and 5 per-component normalized scores
 *
 * Auth: None (public read)
 * Cache: s-maxage=3600, stale-while-revalidate=600
 */
import { NextResponse } from 'next/server'
import { supabase } from '../../../../../../lib/supabase'
import { computeComponentScores, type RawMetrics, type NormParam, type MetricName } from '../../../../../../lib/cron/compute'

export const dynamic = 'force-dynamic'

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ iso2: string }> }
) {
    try {
        const { iso2 } = await params
        const code = iso2.toUpperCase()

        // ── 1. Resolve country ──────────────────────────────────────────────
        const { data: country, error: countryErr } = await supabase
            .from('countries')
            .select('id, name, iso2')
            .eq('iso2', code)
            .maybeSingle()

        if (countryErr) throw countryErr
        if (!country) {
            return NextResponse.json(
                { error: `Country not found: ${code}` },
                { status: 404 }
            )
        }

        // ── 2. Load normalization params ────────────────────────────────────
        const { data: normRows, error: normErr } = await supabase
            .from('normalization_params')
            .select('metric_name, min_val, max_val')
            .eq('country_id', country.id)

        if (normErr) throw normErr
        const normParams: NormParam[] = (normRows ?? []).map(r => ({
            metric_name: r.metric_name as MetricName,
            min_val: r.min_val,
            max_val: r.max_val,
        }))

        // ── 3. Fetch last 30 rows with stress_score ─────────────────────────
        const { data: rows, error: rowErr } = await supabase
            .from('metrics_daily')
            .select('date, stress_score, fx_vol, inflation, risk_spread, crypto_ratio, reserves_change, stablecoin_premium')
            .eq('country_id', country.id)
            .not('stress_score', 'is', null)
            .order('date', { ascending: false })
            .limit(30)

        if (rowErr) throw rowErr
        if (!rows || rows.length === 0) {
            return NextResponse.json([])
        }

        // ── 4. Reverse to chronological order & compute component scores ────
        const history = rows.reverse().map(row => {
            const metrics: RawMetrics = {
                fx_vol: row.fx_vol,
                inflation: row.inflation,
                risk_spread: row.risk_spread,
                crypto_ratio: row.crypto_ratio,
                reserves_change: row.reserves_change,
                stablecoin_premium: row.stablecoin_premium,
            }
            const components = computeComponentScores(metrics, normParams)

            return {
                date: row.date,
                stress_score: row.stress_score,
                components,
            }
        })

        return new Response(JSON.stringify(history), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
            },
        })
    } catch (err: any) {
        console.error('[/api/public/stress/history] Error:', err)
        return NextResponse.json(
            { error: 'Internal server error', message: err.message },
            { status: 500 }
        )
    }
}
