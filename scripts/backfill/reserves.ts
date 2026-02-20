/**
 * Backfill: Reserves Trend (15% weight)
 *
 * Source: IMF SDMX IRFCL dataset
 *   Dataflow: IRFCL
 *   Indicator: RAFA_USD (Total Official Reserve Assets in USD)
 *   Frequency: Monthly
 *
 * Raw stored:   reserves_level (total reserves in USD billions)
 * Derived stored: reserves_change (90-day % change, forward-filled to daily)
 * Frequency: monthly → forward-filled to daily
 *
 * Usage: pnpm tsx scripts/backfill/reserves.ts
 */
import axios from 'axios'
import { supabase } from '../../lib/supabase'
import { pctChange90d } from '../../lib/utils/rolling'

const START_PERIOD = '2019-01'

const COUNTRIES: { iso2: string; imfCode: string }[] = [
    { iso2: 'AR', imfCode: 'AR' },
    { iso2: 'BR', imfCode: 'BR' },
    { iso2: 'CL', imfCode: 'CL' },
    { iso2: 'CO', imfCode: 'CO' },
    { iso2: 'PE', imfCode: 'PE' },
    { iso2: 'MX', imfCode: 'MX' },
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchReserves(imfCode: string): Promise<{ yearMonth: string; value: number }[]> {
    const url = `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IRFCL/M.${imfCode}.RAFA_USD?startPeriod=${START_PERIOD}`
    const { data } = await axios.get(url, { timeout: 30_000 })

    const series = data?.CompactData?.DataSet?.Series
    if (!series) {
        console.warn(`  ⚠️  No IRFCL data found for ${imfCode}`)
        return []
    }

    const obs = Array.isArray(series.Obs) ? series.Obs : [series.Obs]
    return obs
        .filter((o: any) => o?.['@VALUE'] && o?.['@TIME_PERIOD'])
        .map((o: any) => ({
            yearMonth: o['@TIME_PERIOD'] as string, // e.g. "2024-01"
            value: parseFloat(o['@VALUE']),
        }))
        .sort((a: any, b: any) => a.yearMonth.localeCompare(b.yearMonth))
}

/**
 * Expand monthly reserves to daily rows, computing 90-day % change.
 * The 90-day window is computed at monthly granularity (3 months back)
 * then forward-filled to daily.
 */
function expandToDaily(
    monthly: { yearMonth: string; value: number }[]
): { date: string; reserves_level: number; reserves_change: number | null }[] {
    const values = monthly.map((m) => m.value)

    // 90-day window ≈ 3 months at monthly granularity
    const pctChanges = pctChange90d(values as (number | null)[], 3)

    const monthlyWithChange = monthly.map((m, i) => ({
        ...m,
        change: pctChanges[i],
    }))

    const rows: { date: string; reserves_level: number; reserves_change: number | null }[] = []

    for (const m of monthlyWithChange) {
        const [yearStr, monthStr] = m.yearMonth.split('-')
        const year = parseInt(yearStr)
        const month = parseInt(monthStr) - 1

        const daysInMonth = new Date(year, month + 1, 0).getDate()
        for (let day = 1; day <= daysInMonth; day++) {
            const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            rows.push({
                date,
                reserves_level: m.value,
                reserves_change: m.change,
            })
        }
    }

    return rows
}

async function main() {
    console.log('🏛️  Starting Reserves backfill...\n')

    const { data: countries, error } = await supabase.from('countries').select('id, iso2')
    if (error) throw new Error(`Failed to load countries: ${error.message}`)
    const countryMap = Object.fromEntries(countries!.map((c) => [c.iso2, c.id]))

    for (const { iso2, imfCode } of COUNTRIES) {
        const countryId = countryMap[iso2]
        if (!countryId) {
            console.warn(`⚠️  No country found for ${iso2}, skipping`)
            continue
        }

        console.log(`\n🔄 Fetching reserves for ${iso2} (IMF code: ${imfCode})...`)

        try {
            const monthly = await fetchReserves(imfCode)
            console.log(`  ↳ ${monthly.length} monthly data points`)

            if (monthly.length === 0) {
                console.warn(`  ⚠️  No data for ${iso2} — skipping`)
                continue
            }

            const dailyRows = expandToDaily(monthly)
            console.log(`  ↳ Expanded to ${dailyRows.length} daily rows`)

            const dbRows = dailyRows.map((r) => ({
                country_id: countryId,
                date: r.date,
                reserves_level: r.reserves_level,
                reserves_change: r.reserves_change,
            }))

            for (let i = 0; i < dbRows.length; i += 500) {
                const batch = dbRows.slice(i, i + 500)
                const { error: upsertErr } = await supabase
                    .from('metrics_daily')
                    .upsert(batch, { onConflict: 'country_id,date', ignoreDuplicates: false })
                if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`)
                console.log(`  ✓ Upserted ${Math.min(i + 500, dbRows.length)} / ${dbRows.length}`)
            }

            console.log(`  ✅ ${iso2} reserves backfill complete`)
            await sleep(2_000) // Polite delay for IMF API
        } catch (err: any) {
            console.error(`  ❌ Failed for ${iso2}:`, err.message)
        }
    }

    console.log('\n🎉 Reserves backfill complete.')
}

main()
