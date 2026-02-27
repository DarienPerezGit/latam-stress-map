/**
 * fetchers.ts — All external API calls for the daily cron
 *
 * Rules:
 *   - Every function returns data OR null. Never throws.
 *   - Errors are logged to console (caller decides severity).
 *   - Functions are pure IO: take params, return data. No DB calls.
 *   - Timeouts are explicit. Free APIs get 15s max.
 */
import axios from 'axios'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FxDayResult {
    date: string    // 'YYYY-MM-DD' — most recent trading day
    close: number    // USD/CCY close
    arg_blue_gap?: number // ARG only: (blue - official) / official * 100
}

export interface CryptoDayResult {
    date: string
    crypto_ratio: number  // (USDT + USDC mcap) / BTC mcap
}

export interface InflationResult {
    year: number
    value: number  // YoY CPI %
}

export interface SovereignResult {
    yield: number  // % per annum
}

export interface ReservesResult {
    level: number  // total reserves in USD millions
}

export interface StablecoinPremiumResult {
    date: string
    premium: number       // (median_usdt_ars - official) / official * 100
    source_count: number  // how many exchanges contributed to the median
}

// ─── Config ───────────────────────────────────────────────────────────────────

const AV_KEY = process.env.ALPHA_VANTAGE_API_KEY!
const FRED_KEY = process.env.FRED_API_KEY!
const TIMEOUT = 15_000

// Maps iso2 → Alpha Vantage currency code
const FX_SYMBOL: Record<string, string> = {
    AR: 'ARS',
    BR: 'BRL',
    CL: 'CLP',
    CO: 'COP',
    PE: 'PEN',
    MX: 'MXN',
}

// Maps iso2 → FRED series for monthly gov bond yield (only BR and MX)
export const FRED_SOVEREIGN_SERIES: Record<string, string> = {
    BR: 'INTGSTBRM193N',
    MX: 'IRLTLT01MXM156N',
}

// ─── FX ───────────────────────────────────────────────────────────────────────

/**
 * Fetch the most recent FX close for a country.
 * Uses Alpha Vantage FX_DAILY (compact = last 100 days, 1 API call).
 * Returns data for the latest available trading day.
 */
export async function fetchFxDay(iso2: string): Promise<FxDayResult | null> {
    const symbol = FX_SYMBOL[iso2]
    if (!symbol) { console.error(`[fetchers] No FX symbol for ${iso2}`); return null }

    try {
        const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=USD&to_symbol=${symbol}&outputsize=compact&apikey=${AV_KEY}`
        const { data } = await axios.get(url, { timeout: TIMEOUT })

        const timeSeries = data['Time Series FX (Daily)']
        if (!timeSeries) {
            console.error(`[fetchers] FX_DAILY empty for ${iso2}:`, data?.['Note'] ?? data?.['Information'] ?? 'unknown')
            return null
        }

        const latestDate = Object.keys(timeSeries).sort().reverse()[0]
        const close = parseFloat(timeSeries[latestDate]['4. close'])

        const result: FxDayResult = { date: latestDate, close }

        // Argentina: add blue dollar gap
        if (iso2 === 'AR') {
            const blueGap = await fetchArgBlueDayGap(close)
            if (blueGap !== null) result.arg_blue_gap = blueGap
        }

        return result
    } catch (err: any) {
        console.error(`[fetchers] FX failed for ${iso2}:`, err.message)
        return null
    }
}

/**
 * Fetch Argentina blue dollar and compute gap vs official rate.
 */
async function fetchArgBlueDayGap(officialClose: number): Promise<number | null> {
    try {
        const { data } = await axios.get('https://dolarapi.com/v1/dolares/blue', { timeout: TIMEOUT })
        const blueVenta = data?.venta
        if (!blueVenta) return null
        // Gap = (blue - official) / official * 100
        const officialUsdArs = officialClose // already USD/ARS
        const blueUsdArs = blueVenta     // blue ARS per USD
        return Math.round(((blueUsdArs - officialUsdArs) / officialUsdArs) * 100 * 100) / 100
    } catch (err: any) {
        console.error('[fetchers] ARG blue failed:', err.message)
        return null
    }
}

// ─── Crypto ───────────────────────────────────────────────────────────────────

/**
 * Compute today's stablecoin dominance ratio: (USDT + USDC mcap) / BTC mcap.
 * Uses CoinGecko /coins/markets (free, no auth).
 * Returns a single global value applied to all countries.
 */
export async function fetchCryptoDay(): Promise<CryptoDayResult | null> {
    try {
        const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=tether,usd-coin,bitcoin&order=market_cap_desc&per_page=10&page=1'
        const { data } = await axios.get(url, {
            timeout: TIMEOUT,
            headers: { 'Accept': 'application/json' },
        })

        const coinMap: Record<string, number> = {}
        for (const coin of data) {
            coinMap[coin.id] = coin.market_cap
        }

        const usdtMcap = coinMap['tether']
        const usdcMcap = coinMap['usd-coin']
        const btcMcap = coinMap['bitcoin']

        if (!usdtMcap || !btcMcap) {
            console.error('[fetchers] Crypto missing required coins:', coinMap)
            return null
        }

        const crypto_ratio = ((usdtMcap + (usdcMcap ?? 0)) / btcMcap)
        const today = new Date().toISOString().split('T')[0]

        return { date: today, crypto_ratio: Math.round(crypto_ratio * 10000) / 10000 }
    } catch (err: any) {
        console.error('[fetchers] Crypto failed:', err.message)
        return null
    }
}

// ─── Inflation (monthly cadence) ──────────────────────────────────────────────

/**
 * Fetch the latest World Bank annual YoY CPI for a country.
 * Only called on the first day of each month.
 */
export async function fetchInflationLatest(iso2: string): Promise<InflationResult | null> {
    try {
        const url = `https://api.worldbank.org/v2/country/${iso2}/indicator/FP.CPI.TOTL.ZG?format=json&mrv=3`
        const { data } = await axios.get(url, { timeout: TIMEOUT })
        const records = (data[1] ?? []).filter((r: any) => r.value !== null)
        if (records.length === 0) return null
        const latest = records[0]
        return { year: parseInt(latest.date), value: latest.value }
    } catch (err: any) {
        console.error(`[fetchers] Inflation failed for ${iso2}:`, err.message)
        return null
    }
}

// ─── Sovereign Risk (monthly cadence) ─────────────────────────────────────────

/**
 * Fetch US 10Y yield from FRED (daily).
 */
export async function fetchUs10yDay(): Promise<number | null> {
    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=5&observation_start=${getPriorDate(7)}`
        const { data } = await axios.get(url, { timeout: TIMEOUT })
        const obs = (data.observations ?? []).filter((o: any) => o.value !== '.')
        if (obs.length === 0) return null
        return parseFloat(obs[0].value)
    } catch (err: any) {
        console.error('[fetchers] US 10Y failed:', err.message)
        return null
    }
}

/**
 * Fetch latest sovereign yield from FRED (BR, MX).
 * Returns null if series not available for this country.
 */
export async function fetchSovereignFred(iso2: string): Promise<SovereignResult | null> {
    const seriesId = FRED_SOVEREIGN_SERIES[iso2]
    if (!seriesId) return null

    try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`
        const { data } = await axios.get(url, { timeout: TIMEOUT })
        const obs = (data.observations ?? []).filter((o: any) => o.value !== '.')
        if (obs.length === 0) return null
        return { yield: parseFloat(obs[0].value) }
    } catch (err: any) {
        console.error(`[fetchers] FRED sovereign failed for ${iso2}:`, err.message)
        return null
    }
}

/**
 * Fetch latest sovereign yield from IMF IFS SDMX (AR, CL, CO, PE).
 * Returns null if IMF is unavailable (frequent outages — handled upstream).
 */
export async function fetchSovereignImf(iso2: string): Promise<SovereignResult | null> {
    try {
        const url = `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IFS/M.${iso2}.FIGB_PA`
        const { data } = await axios.get(url, { timeout: TIMEOUT })
        const series = data?.CompactData?.DataSet?.Series
        if (!series) return null
        const obs = Array.isArray(series.Obs) ? series.Obs : [series.Obs]
        const latest = obs
            .filter((o: any) => o?.['@VALUE'])
            .sort((a: any, b: any) => b['@TIME_PERIOD'].localeCompare(a['@TIME_PERIOD']))[0]
        if (!latest) return null
        return { yield: parseFloat(latest['@VALUE']) }
    } catch (err: any) {
        console.error(`[fetchers] IMF sovereign failed for ${iso2}:`, err.message)
        return null
    }
}

// ─── Reserves (monthly cadence) ───────────────────────────────────────────────

/**
 * Fetch latest total reserves from IMF IRFCL.
 * Returns null if IMF is unavailable.
 */
export async function fetchReservesImf(iso2: string): Promise<ReservesResult | null> {
    try {
        const url = `https://dataservices.imf.org/REST/SDMX_JSON.svc/CompactData/IRFCL/M.${iso2}.RAFA_USD`
        const { data } = await axios.get(url, { timeout: TIMEOUT })
        const series = data?.CompactData?.DataSet?.Series
        if (!series) return null
        const obs = Array.isArray(series.Obs) ? series.Obs : [series.Obs]
        const sorted = obs
            .filter((o: any) => o?.['@VALUE'])
            .sort((a: any, b: any) => b['@TIME_PERIOD'].localeCompare(a['@TIME_PERIOD']))
        if (sorted.length === 0) return null
        return { level: parseFloat(sorted[0]['@VALUE']) }
    } catch (err: any) {
        console.error(`[fetchers] IMF reserves failed for ${iso2}:`, err.message)
        return null
    }
}

// ─── Stablecoin Premium (daily, AR only) ──────────────────────────────────────

/**
 * Fetch the USDT P2P premium vs official FX rate.
 * Uses CriptoYa aggregator (free, no auth).
 * Only meaningful for Argentina — returns null for all other countries.
 *
 * CriptoYa /api/usdt/ars returns:
 *   { "exchange": { "ask": N, "bid": N, "totalAsk": N, "totalBid": N, "time": N }, ... }
 * We take the median of all `totalAsk` values as the representative P2P price.
 */
export async function fetchStablecoinPremium(
    iso2: string,
    officialFxClose: number
): Promise<StablecoinPremiumResult | null> {
    if (iso2 !== 'AR') return null
    if (!officialFxClose || officialFxClose <= 0) return null

    try {
        const url = 'https://criptoya.com/api/usdt/ars'
        const { data } = await axios.get(url, {
            timeout: TIMEOUT,
            headers: { 'Accept': 'application/json' },
        })

        if (!data || typeof data !== 'object') {
            console.error('[fetchers] CriptoYa: unexpected response shape')
            return null
        }

        // Extract totalAsk from each exchange (the actual cost to buy 1 USDT in ARS)
        const prices: number[] = []
        for (const [exchange, info] of Object.entries(data)) {
            // Skip non-exchange keys (e.g. "time")
            if (!info || typeof info !== 'object') continue
            const entry = info as Record<string, unknown>
            const totalAsk = entry['totalAsk']
            if (typeof totalAsk === 'number' && totalAsk > 0) {
                prices.push(totalAsk)
            }
        }

        if (prices.length < 2) {
            console.error(`[fetchers] CriptoYa: only ${prices.length} exchange(s) returned data`)
            return null
        }

        // Median
        prices.sort((a, b) => a - b)
        const mid = Math.floor(prices.length / 2)
        const median = prices.length % 2 === 0
            ? (prices[mid - 1] + prices[mid]) / 2
            : prices[mid]

        // Premium = (median_usdt_ars - official_usd_ars) / official_usd_ars * 100
        const premium = Math.round(((median - officialFxClose) / officialFxClose) * 100 * 100) / 100
        const today = new Date().toISOString().split('T')[0]

        console.log(`  [fetchers] AR stablecoin premium: ${premium}% (median ${median} vs official ${officialFxClose}, ${prices.length} sources)`)

        return { date: today, premium, source_count: prices.length }
    } catch (err: any) {
        console.error('[fetchers] CriptoYa failed:', err.message)
        return null
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPriorDate(days: number): string {
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString().split('T')[0]
}
