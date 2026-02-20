/**
 * Backfill: FX Volatility (30% weight)
 *
 * Sources:
 *   - Alpha Vantage FX_DAILY (official rate, all 6 countries)
 *   - dolarapi.com (Argentina blue dollar gap, parallel rate)
 *
 * Metric stored:
 *   - fx_close:   daily close price (raw)
 *   - fx_vol:     30-day rolling std dev of log returns (derived)
 *   - arg_blue_gap: (official - blue) / official * 100 — Argentina only
 *
 * Usage: pnpm tsx scripts/backfill/fx.ts
 */
import axios from 'axios'
import * as dotenv from 'dotenv'
import { supabase } from '../../lib/supabase'
import { rollingLogReturnStdDev } from '../../lib/utils/rolling'

dotenv.config({ path: '.env.local' })

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY!
if (!AV_KEY) throw new Error('Missing ALPHA_VANTAGE_API_KEY in .env.local')

const CURRENCIES = [
    { iso2: 'AR', currency: 'ARS' },
    { iso2: 'BR', currency: 'BRL' },
    { iso2: 'CL', currency: 'CLP' },
    { iso2: 'CO', currency: 'COP' },
    { iso2: 'PE', currency: 'PEN' },
    { iso2: 'MX', currency: 'MXN' },
]

/** Sleep to respect API rate limits */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchFxHistory(currency: string): Promise<{ date: string; close: number }[]> {
    const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=USD&to_symbol=${currency}&outputsize=full&apikey=${AV_KEY}`
    const { data } = await axios.get(url, { timeout: 30_000 })

    if (data['Error Message']) throw new Error(`Alpha Vantage error: ${data['Error Message']}`)
    if (data['Note']) throw new Error(`Alpha Vantage rate limit hit: ${data['Note']}`)

    const series = data['Time Series FX (Daily)']
    if (!series) throw new Error(`No time series returned for ${currency}`)

    return Object.entries(series)
        .map(([date, values]: [string, any]) => ({
            date,
            close: parseFloat(values['4. close']),
        }))
        .sort((a, b) => a.date.localeCompare(b.date)) // ascending
}

async function fetchArgBlueRate(): Promise<{ buy: number; sell: number } | null> {
    try {
        const { data } = await axios.get('https://dolarapi.com/v1/dolares/blue', { timeout: 10_000 })
        return { buy: data.compra, sell: data.venta }
    } catch (e: any) {
        console.warn('  ⚠️  dolarapi.com unavailable:', e.message)
        return null
    }
}

async function upsertFxRows(
    countryId: number,
    iso2: string,
    history: { date: string; close: number }[],
    blueRate: { buy: number; sell: number } | null
) {
    const closes = history.map((h) => h.close)
    const stdDevs = rollingLogReturnStdDev(closes, 30)

    const rows = history.map((h, i) => {
        const row: Record<string, any> = {
            country_id: countryId,
            date: h.date,
            fx_close: h.close,
            fx_vol: stdDevs[i] ?? null,
        }

        // Argentina blue gap — only for today's data point (latest row)
        // Historical blue gap not available from free API; stored as null for historical dates
        if (iso2 === 'AR' && i === history.length - 1 && blueRate) {
            const officialRate = h.close
            const blueVenta = blueRate.sell
            row.arg_blue_gap = ((blueVenta - officialRate) / officialRate) * 100
        }

        return row
    })

    // Upsert in batches of 500
    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500)
        const { error } = await supabase
            .from('metrics_daily')
            .upsert(batch, { onConflict: 'country_id,date', ignoreDuplicates: false })

        if (error) {
            console.error(`  ❌ Upsert error (batch ${i / 500}):`, error.message)
            throw error
        }
        console.log(`  ✓ Upserted rows ${i + 1}–${Math.min(i + 500, rows.length)}`)
    }
}

async function main() {
    console.log('📈 Starting FX backfill...\n')

    // Fetch all country IDs from DB
    const { data: countries, error: countryErr } = await supabase
        .from('countries')
        .select('id, iso2')
    if (countryErr) throw new Error(`Failed to load countries: ${countryErr.message}`)

    const countryMap = Object.fromEntries(countries!.map((c) => [c.iso2, c.id]))

    for (const { iso2, currency } of CURRENCIES) {
        const countryId = countryMap[iso2]
        if (!countryId) {
            console.warn(`⚠️  No country found for ${iso2}, skipping`)
            continue
        }

        console.log(`\n🔄 Fetching ${currency} (${iso2})...`)

        try {
            const history = await fetchFxHistory(currency)
            console.log(`  ↳ ${history.length} daily data points fetched`)

            let blueRate: { buy: number; sell: number } | null = null
            if (iso2 === 'AR') {
                console.log('  ↳ Fetching Argentina blue dollar rate...')
                blueRate = await fetchArgBlueRate()
                if (blueRate) console.log(`  ↳ Blue rate: buy=${blueRate.buy}, sell=${blueRate.sell}`)
            }

            await upsertFxRows(countryId, iso2, history, blueRate)
            console.log(`  ✅ ${iso2} FX backfill complete`)
        } catch (err: any) {
            console.error(`  ❌ Failed for ${iso2}:`, err.message)
        }

        // 15s delay between requests to respect AV free tier (25 req/day)
        if (CURRENCIES.indexOf({ iso2, currency }) < CURRENCIES.length - 1) {
            console.log('  ⏳ Waiting 15s before next request...')
            await sleep(15_000)
        }
    }

    console.log('\n🎉 FX backfill complete.')
}

main()
