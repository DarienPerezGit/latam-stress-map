/**
 * Backfill: Inflation Acceleration (20% weight)
 *
 * Source: World Bank API — Indicator FP.CPI.TOTL.ZG (Annual YoY CPI %)
 *
 * Notes on data:
 *   - FP.CPI.TOTL.ZG is ANNUAL only (no monthly frequency on free WB API).
 *   - We fetch up to 30 years of annual data.
 *   - "acceleration" = latest YoY minus 2-yr prior YoY (annual window).
 *   - Forward-filled daily: every day in a given year gets that year's value.
 *   - inflation_yoy = raw annual CPI %
 *   - inflation = acceleration metric fed into normalization
 *
 * Usage: pnpm tsx scripts/backfill/inflation.ts
 */
import axios from 'axios'
import { supabase } from '../../lib/supabase'

const WB_INDICATOR = 'FP.CPI.TOTL.ZG'
const MRV = 30 // years of history

const COUNTRIES_ISO2 = ['AR', 'BR', 'CL', 'CO', 'PE', 'MX']

interface WBDataPoint {
    date: string    // "YYYY" — annual
    value: number | null
}

async function fetchInflationData(iso2: string): Promise<{ year: number; value: number }[]> {
    const url = `https://api.worldbank.org/v2/country/${iso2}/indicator/${WB_INDICATOR}?format=json&mrv=${MRV}`
    const { data } = await axios.get(url, { timeout: 30_000 })

    const records: WBDataPoint[] = data[1] ?? []
    return records
        .filter((r) => r.value !== null)
        .map((r) => ({ year: parseInt(r.date), value: r.value as number }))
        .sort((a, b) => a.year - b.year)
}

/**
 * Expand annual data to daily rows via forward-fill.
 * Returns one row per calendar day from Jan 1 of the first year through Dec 31 of the last.
 */
function expandAnnualToDaily(
    annual: { year: number; value: number; acceleration: number | null }[]
): { date: string; inflation_yoy: number; inflation: number | null }[] {
    const rows: { date: string; inflation_yoy: number; inflation: number | null }[] = []

    for (const entry of annual) {
        const { year, value, acceleration } = entry
        // All 365/366 days in this year
        const startDate = new Date(year, 0, 1)
        const endDate = new Date(year, 11, 31)

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const iso = d.toISOString().split('T')[0]
            rows.push({ date: iso, inflation_yoy: value, inflation: acceleration })
        }
    }

    return rows
}

async function main() {
    console.log('📊 Starting Inflation backfill (annual WB data)...\n')

    const { data: countries, error: countryErr } = await supabase
        .from('countries')
        .select('id, iso2')
    if (countryErr) throw new Error(`Failed to load countries: ${countryErr.message}`)

    const countryMap = Object.fromEntries(countries!.map((c) => [c.iso2, c.id]))

    for (const iso2 of COUNTRIES_ISO2) {
        const countryId = countryMap[iso2]
        if (!countryId) { console.warn(`⚠️  No country found for ${iso2}, skipping`); continue }

        console.log(`\n🔄 Fetching inflation for ${iso2}...`)
        try {
            const annual = await fetchInflationData(iso2)
            console.log(`  ↳ ${annual.length} annual data points fetched`)

            if (annual.length === 0) { console.warn(`  ⚠️  No data for ${iso2}, skipping`); continue }

            // Compute acceleration = value[i] - value[i-2] (delta over 2 years, annualized)
            // We use i-2 rather than i-1 to smooth single-year noise.
            const annualWithAccel = annual.map((entry, i) => ({
                ...entry,
                acceleration: i >= 2 ? entry.value - annual[i - 2].value : null,
            }))

            // Expand to daily
            const dailyRows = expandAnnualToDaily(annualWithAccel)
            console.log(`  ↳ Expanded to ${dailyRows.length} daily rows`)

            // Upsert in batches of 500
            const dbRows = dailyRows.map((r) => ({
                country_id: countryId,
                date: r.date,
                inflation_yoy: r.inflation_yoy,
                inflation: r.inflation,
            }))

            for (let i = 0; i < dbRows.length; i += 500) {
                const batch = dbRows.slice(i, i + 500)
                const { error } = await supabase
                    .from('metrics_daily')
                    .upsert(batch, { onConflict: 'country_id,date', ignoreDuplicates: false })
                if (error) throw new Error(`Upsert failed: ${error.message}`)
                console.log(`  ✓ Upserted rows ${i + 1}–${Math.min(i + 500, dbRows.length)}`)
            }

            console.log(`  ✅ ${iso2} inflation backfill complete`)
            await new Promise((r) => setTimeout(r, 2_000))
        } catch (err: any) {
            console.error(`  ❌ Failed for ${iso2}:`, err.message)
        }
    }

    console.log('\n🎉 Inflation backfill complete.')
}

main()
