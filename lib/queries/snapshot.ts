/**
 * lib/queries/snapshot.ts
 *
 * Pure Supabase query functions for the /api/snapshot route.
 * Shared to avoid internal HTTP self-fetch on Edge runtime.
 *
 * Uses its own Edge-safe Supabase client to avoid pulling in `dotenv`
 * (which calls process.cwd() — a Node.js-only API forbidden in Vercel Edge Runtime).
 */
import { createClient } from '@supabase/supabase-js'
import {
    computeComponentScores,
    type RawMetrics,
    type NormParam,
    type MetricName,
} from '../cron/compute'

// Edge-safe factory — env vars are injected by Next.js at build time.
// Never import lib/supabase here: it pulls in `dotenv` which calls process.cwd().
function getSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Missing Supabase env vars for snapshot route')
    return createClient(url, key, { auth: { persistSession: false } })
}

export interface CountrySnapshotData {
    country: string
    iso2: string
    stress_score: number
    rank: number
    delta_7d: number | null
    delta_30d: number | null
    date: string
}

export interface HistoryPoint {
    date: string
    stress_score: number
    components: Record<string, number | null>
}

function getOffsetDate(dateStr: string, days: number): string {
    const d = new Date(dateStr)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
}

/**
 * Fetch current stress snapshot for a single country.
 */
export async function getCountrySnapshot(
    iso2: string
): Promise<CountrySnapshotData | null> {
    const supabase = getSupabase()
    const code = iso2.toUpperCase()

    const { data: countries } = await supabase
        .from('countries')
        .select('id, name, iso2')

    if (!countries) return null

    const country = countries.find(c => c.iso2 === code)
    if (!country) return null

    const { data: latest } = await supabase
        .from('metrics_daily')
        .select('date, stress_score')
        .eq('country_id', country.id)
        .not('stress_score', 'is', null)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!latest?.stress_score) return null

    const { data: row7d } = await supabase
        .from('metrics_daily')
        .select('stress_score')
        .eq('country_id', country.id)
        .lte('date', getOffsetDate(latest.date, -7))
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    const { data: row30d } = await supabase
        .from('metrics_daily')
        .select('stress_score')
        .eq('country_id', country.id)
        .lte('date', getOffsetDate(latest.date, -30))
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

    let rank = 1
    for (const c of countries) {
        if (c.id === country.id) continue
        const { data: other } = await supabase
            .from('metrics_daily')
            .select('stress_score')
            .eq('country_id', c.id)
            .not('stress_score', 'is', null)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()
        if (other?.stress_score != null && other.stress_score > latest.stress_score) {
            rank++
        }
    }

    const round1 = (n: number) => Math.round(n * 10) / 10

    return {
        country: country.name,
        iso2: country.iso2,
        stress_score: latest.stress_score,
        rank,
        delta_7d: row7d?.stress_score != null
            ? round1(latest.stress_score - row7d.stress_score)
            : null,
        delta_30d: row30d?.stress_score != null
            ? round1(latest.stress_score - row30d.stress_score)
            : null,
        date: latest.date,
    }
}

/**
 * Fetch 30-day stress history for a single country.
 */
export async function getCountryHistory(
    iso2: string
): Promise<HistoryPoint[]> {
    const supabase = getSupabase()
    const code = iso2.toUpperCase()

    const { data: country } = await supabase
        .from('countries')
        .select('id')
        .eq('iso2', code)
        .maybeSingle()

    if (!country) return []

    const { data: normRows } = await supabase
        .from('normalization_params')
        .select('metric_name, min_val, max_val')
        .eq('country_id', country.id)

    const normParams: NormParam[] = (normRows ?? []).map(r => ({
        metric_name: r.metric_name as MetricName,
        min_val: r.min_val,
        max_val: r.max_val,
    }))

    const { data: rows } = await supabase
        .from('metrics_daily')
        .select('date, stress_score, fx_vol, inflation, risk_spread, crypto_ratio, reserves_change')
        .eq('country_id', country.id)
        .not('stress_score', 'is', null)
        .order('date', { ascending: false })
        .limit(30)

    if (!rows || rows.length === 0) return []

    return rows.reverse().map(row => {
        const metrics: RawMetrics = {
            fx_vol: row.fx_vol,
            inflation: row.inflation,
            risk_spread: row.risk_spread,
            crypto_ratio: row.crypto_ratio,
            reserves_change: row.reserves_change,
        }
        return {
            date: row.date,
            stress_score: row.stress_score,
            components: computeComponentScores(metrics, normParams),
        }
    })
}
