/**
 * Backfill: Sovereign Risk (20% weight)
 *
 * Sources:
 *   - FRED API: Brazil (INTGSBRZM193N), Mexico (INTGSB01M193N), US 10Y (DGS10)
 *   - IMF IFS SDMX: Argentina, Chile, Colombia, Peru
 *
 * Raw stored:   sovereign_yield (country 10Y yield %), us_10y (US 10Y %)
 * Derived stored: risk_spread = sovereign_yield - us_10y
 * Frequency: monthly → forward-filled to daily
 *
 * Usage: pnpm tsx scripts/backfill/sovereign.ts
 */
import axios from 'axios'
import * as dotenv from 'dotenv'
import { supabase } from '../../lib/supabase'

dotenv.config({ path: '.env.local' })

const FRED_KEY = process.env.FRED_API_KEY!
if (!FRED_KEY) throw new Error('Missing FRED_API_KEY in .env.local')

// FRED series IDs for US 10Y (daily) and country yields (monthly)
const FRED_US_10Y_SERIES = 'DGS10'
const FRED_COUNTRY_SERIES: Record<string, string> = {
    BR: 'INTGSTBRM193N',     // Brazil — IMF IFS gov bond yield via FRED, monthly
    MX: 'IRLTLT01MXM156N',   // Mexico — OECD 10Y long-term gov bond yield, monthly
}

// Countries using IMF IFS fallback (SDMX)
// Indicator: FIGB_PA = Government Bond Yield (% per annum)
const IMF_COUNTRIES: Record<string, string> = {
    AR: 'AR',
    CL: 'CL',
    CO: 'CO',
    PE: 'PE',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchFredSeries(seriesId: string): Promise<{ date: string; value: number }[]> {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=asc&observation_start=2019-01-01`
    const { data } = await axios.get(url, { timeout: 20_000 })
    return data.observations
        .filter((o: any) => o.value !== '.')
        .map((o: any) => ({ date: o.date, value: parseFloat(o.value) }))
}

async function fetchImfYield(imfCode: string): Promise<{ yearMonth: string; value: number }[]> {
    // IMF IFS: Government Bond Yield per annum
    const url = `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS/M.${imfCode}.FIGB_PA?startPeriod=2019-01`
    try {
        const { data } = await axios.get(url, { timeout: 20_000 })
        const series = data?.CompactData?.DataSet?.Series
        if (!series) return []
        const obs = Array.isArray(series.Obs) ? series.Obs : [series.Obs]
        return obs
            .filter((o: any) => o?.['@VALUE'] && o?.['@TIME_PERIOD'])
            .map((o: any) => ({
                yearMonth: o['@TIME_PERIOD'], // "2024-01"
                value: parseFloat(o['@VALUE']),
            }))
            .sort((a: any, b: any) => a.yearMonth.localeCompare(b.yearMonth))
    } catch (e: any) {
        console.warn(`  ⚠️  IMF IFS unavailable for ${imfCode}:`, e.message)
        return []
    }
}

/** Build a daily lookup map for monthly data by forward-filling. */
function buildDailyMapFromMonthly(
    monthly: { yearMonth: string; value: number }[]
): Map<string, number> {
    const map = new Map<string, number>()
    if (monthly.length === 0) return map

    // Get date range
    const [firstYear, firstMonth] = monthly[0].yearMonth.split('-').map(Number)
    const startDate = new Date(firstYear, firstMonth - 1, 1)
    const endDate = new Date()

    // Build month→value lookup
    const monthMap = new Map(monthly.map((m) => [m.yearMonth, m.value]))

    const cursor = new Date(startDate)
    let lastKnownValue: number | null = null

    while (cursor <= endDate) {
        const yearMonth = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
        if (monthMap.has(yearMonth)) lastKnownValue = monthMap.get(yearMonth)!

        if (lastKnownValue !== null) {
            const dateStr = cursor.toISOString().split('T')[0]
            map.set(dateStr, lastKnownValue)
        }
        cursor.setDate(cursor.getDate() + 1)
    }

    return map
}

/** Build a daily lookup map for FRED daily data (already daily). */
function buildDailyMapFromFredDaily(
    daily: { date: string; value: number }[]
): Map<string, number> {
    // Forward-fill weekends/holidays
    const map = new Map<string, number>()
    if (daily.length === 0) return map

    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
    const startDate = new Date(sorted[0].date)
    const endDate = new Date()
    const fredMap = new Map(sorted.map((d) => [d.date, d.value]))

    const cursor = new Date(startDate)
    let lastKnown: number | null = null

    while (cursor <= endDate) {
        const dateStr = cursor.toISOString().split('T')[0]
        if (fredMap.has(dateStr)) lastKnown = fredMap.get(dateStr)!
        if (lastKnown !== null) map.set(dateStr, lastKnown)
        cursor.setDate(cursor.getDate() + 1)
    }

    return map
}

async function main() {
    console.log('🏦 Starting Sovereign Risk backfill...\n')

    const { data: countries, error } = await supabase.from('countries').select('id, iso2')
    if (error) throw new Error(`Failed to load countries: ${error.message}`)
    const countryMap = Object.fromEntries(countries!.map((c) => [c.iso2, c.id]))

    // 1. Fetch US 10Y (FRED daily)
    console.log('🔄 Fetching US 10Y (DGS10) from FRED...')
    const us10yDaily = await fetchFredSeries(FRED_US_10Y_SERIES)
    const us10yMap = buildDailyMapFromFredDaily(us10yDaily)
    console.log(`  ↳ ${us10yMap.size} daily US 10Y values`)

    await sleep(2_000)

    // 2. FRED countries (Brazil, Mexico)
    for (const [iso2, seriesId] of Object.entries(FRED_COUNTRY_SERIES)) {
        const countryId = countryMap[iso2]
        if (!countryId) continue

        console.log(`\n🔄 Fetching ${iso2} yield from FRED (${seriesId})...`)
        const monthly = await fetchFredSeries(seriesId)
        // FRED monthly series — dates are "2024-01-01" (first of month)
        const monthlyFormatted = monthly.map((m) => {
            const [year, month] = m.date.split('-')
            return { yearMonth: `${year}-${month}`, value: m.value }
        })
        const countryDailyMap = buildDailyMapFromMonthly(monthlyFormatted)
        console.log(`  ↳ ${countryDailyMap.size} daily rows after forward-fill`)

        // Build upsert rows
        const rows: any[] = []
        countryDailyMap.forEach((yield_, date) => {
            const us10y = us10yMap.get(date) ?? null
            rows.push({
                country_id: countryId,
                date,
                sovereign_yield: yield_,
                us_10y: us10y,
                risk_spread: us10y !== null ? yield_ - us10y : null,
            })
        })

        for (let i = 0; i < rows.length; i += 500) {
            const batch = rows.slice(i, i + 500)
            const { error: upsertErr } = await supabase
                .from('metrics_daily')
                .upsert(batch, { onConflict: 'country_id,date', ignoreDuplicates: false })
            if (upsertErr) throw new Error(`Upsert error: ${upsertErr.message}`)
            console.log(`  ✓ Upserted ${Math.min(i + 500, rows.length)} / ${rows.length}`)
        }

        console.log(`  ✅ ${iso2} sovereign backfill complete`)
        await sleep(2_000)
    }

    // 3. IMF IFS countries (Argentina, Chile, Colombia, Peru)
    for (const [iso2, imfCode] of Object.entries(IMF_COUNTRIES)) {
        const countryId = countryMap[iso2]
        if (!countryId) continue

        console.log(`\n🔄 Fetching ${iso2} yield from IMF IFS (${imfCode})...`)
        const monthly = await fetchImfYield(imfCode)
        console.log(`  ↳ ${monthly.length} monthly data points`)

        if (monthly.length === 0) {
            console.warn(`  ⚠️  No IMF data for ${iso2} — risk_spread will remain null`)
            continue
        }

        const countryDailyMap = buildDailyMapFromMonthly(monthly)
        console.log(`  ↳ ${countryDailyMap.size} daily rows after forward-fill`)

        const rows: any[] = []
        countryDailyMap.forEach((yield_, date) => {
            const us10y = us10yMap.get(date) ?? null
            rows.push({
                country_id: countryId,
                date,
                sovereign_yield: yield_,
                us_10y: us10y,
                risk_spread: us10y !== null ? yield_ - us10y : null,
            })
        })

        for (let i = 0; i < rows.length; i += 500) {
            const batch = rows.slice(i, i + 500)
            const { error: upsertErr } = await supabase
                .from('metrics_daily')
                .upsert(batch, { onConflict: 'country_id,date', ignoreDuplicates: false })
            if (upsertErr) throw new Error(`Upsert error: ${upsertErr.message}`)
            console.log(`  ✓ Upserted ${Math.min(i + 500, rows.length)} / ${rows.length}`)
        }

        console.log(`  ✅ ${iso2} sovereign backfill complete`)
        await sleep(2_000)
    }

    console.log('\n🎉 Sovereign Risk backfill complete.')
}

main()
