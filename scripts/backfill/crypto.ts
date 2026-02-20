/**
 * Backfill: Crypto Hedge Activity (15% weight)
 *
 * Source: CoinGecko Demo API (no key required)
 *
 * Strategy:
 *   Fetch daily market_caps for:
 *     - USDT (tether)
 *     - USDC (usd-coin)
 *     - BTC (bitcoin) — used as denominator proxy for total market cap
 *
 *   Metric:
 *     stablecoin_dominance = (usdt_mcap + usdc_mcap) / btc_mcap
 *
 *   IMPORTANT DESIGN NOTE:
 *     /global endpoint only returns a current snapshot (no history).
 *     /global/market_cap_chart is Pro-only.
 *     BTC market cap is used as a free, programmatic, and stable denominator proxy.
 *     The ratio rises when stablecoin demand increases relative to BTC — a valid
 *     stress signal documented openly on the methodology page.
 *
 *   Window: 365 days only (Demo API limit). This is intentional and documented.
 *   normalization_params for crypto uses 1yr window, unlike other metrics (5yr).
 *
 *   This value is GLOBAL (same for all 6 countries per day) — by design.
 *
 * Usage: pnpm tsx scripts/backfill/crypto.ts
 */
import axios from 'axios'
import { supabase } from '../../lib/supabase'

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'
const DAYS = 365

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface CoinGeckoChartResponse {
    market_caps: [number, number][] // [timestamp_ms, value]
}

async function fetchMarketCapHistory(coinId: string): Promise<Map<string, number>> {
    const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${DAYS}&interval=daily`
    const { data }: { data: CoinGeckoChartResponse } = await axios.get(url, { timeout: 20_000 })

    const map = new Map<string, number>()
    for (const [ts, val] of data.market_caps) {
        const date = new Date(ts).toISOString().split('T')[0]
        map.set(date, val)
    }
    return map
}

async function main() {
    console.log('₿ Starting Crypto Hedge backfill...\n')
    console.log(`  Window: last ${DAYS} days (Demo API limit — intentional, documented)`)
    console.log('  Metric: (USDT mcap + USDC mcap) / BTC mcap\n')

    const { data: countries, error } = await supabase.from('countries').select('id, iso2')
    if (error) throw new Error(`Failed to load countries: ${error.message}`)

    // Fetch USDT market cap history
    console.log('🔄 Fetching USDT market cap history...')
    const usdtMap = await fetchMarketCapHistory('tether')
    console.log(`  ↳ ${usdtMap.size} data points`)

    await sleep(3_000) // Polite delay between CoinGecko requests

    // Fetch USDC market cap history
    console.log('🔄 Fetching USDC market cap history...')
    const usdcMap = await fetchMarketCapHistory('usd-coin')
    console.log(`  ↳ ${usdcMap.size} data points`)

    await sleep(3_000)

    // Fetch BTC market cap history (denominator proxy)
    console.log('🔄 Fetching BTC market cap history (denominator proxy)...')
    const btcMap = await fetchMarketCapHistory('bitcoin')
    console.log(`  ↳ ${btcMap.size} data points`)

    // Build global dominance series
    const allDates = new Set([...usdtMap.keys(), ...usdcMap.keys(), ...btcMap.keys()])
    const sortedDates = [...allDates].sort()

    console.log(`\n📐 Computing stablecoin dominance ratio for ${sortedDates.length} dates...`)

    const globalRatioByDate = new Map<string, number | null>()
    for (const date of sortedDates) {
        const usdt = usdtMap.get(date) ?? null
        const usdc = usdcMap.get(date) ?? null
        const btc = btcMap.get(date) ?? null

        if (usdt !== null && usdc !== null && btc !== null && btc > 0) {
            globalRatioByDate.set(date, (usdt + usdc) / btc)
        } else {
            globalRatioByDate.set(date, null)
        }
    }

    // Upsert for ALL 6 countries (same global value per date)
    console.log('\n💾 Upserting crypto_ratio for all countries...')

    for (const country of countries!) {
        console.log(`\n  🔄 ${country.iso2}...`)
        const rows: any[] = []

        globalRatioByDate.forEach((ratio, date) => {
            if (ratio === null) return
            rows.push({
                country_id: country.id,
                date,
                crypto_ratio: ratio,
            })
        })

        for (let i = 0; i < rows.length; i += 500) {
            const batch = rows.slice(i, i + 500)
            const { error: upsertErr } = await supabase
                .from('metrics_daily')
                .upsert(batch, { onConflict: 'country_id,date', ignoreDuplicates: false })
            if (upsertErr) throw new Error(`Upsert error for ${country.iso2}: ${upsertErr.message}`)
        }

        console.log(`  ✅ ${rows.length} rows upserted for ${country.iso2}`)
    }

    console.log('\n🎉 Crypto Hedge backfill complete.')
    console.log('   📝 Note: normalization window for this metric = 365 days (not 5yr).')
    console.log('   This is documented in normalization_params.window_start/end.')
}

main()
