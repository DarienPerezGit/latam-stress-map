/**
 * Compute normalization parameters (p5/p95) from historical backfill data.
 *
 * For each country × metric:
 *   - Reads all historical rows from metrics_daily
 *   - Computes p5 (min clamp) and p95 (max clamp)
 *   - Upserts into normalization_params
 *
 * Window rules:
 *   - crypto_ratio: last 365 days only (API constraint, documented)
 *   - All other metrics: all available history
 *
 * method stored: "p5_p95_clamped"
 *
 * Usage: pnpm tsx scripts/compute-normalization.ts
 */
import { supabase } from '../lib/supabase'
import { percentile } from '../lib/utils/rolling'
import { format, subDays } from 'date-fns'

type MetricName = 'fx_vol' | 'inflation' | 'risk_spread' | 'crypto_ratio' | 'reserves_change'

const METRIC_CONFIG: Record<MetricName, { column: string; window365: boolean }> = {
    fx_vol: { column: 'fx_vol', window365: false },
    inflation: { column: 'inflation', window365: false },
    risk_spread: { column: 'risk_spread', window365: false },
    crypto_ratio: { column: 'crypto_ratio', window365: true }, // 1yr only
    reserves_change: { column: 'reserves_change', window365: false },
}

async function fetchMetricValues(
    countryId: number,
    column: string,
    window365: boolean
): Promise<number[]> {
    let query = supabase
        .from('metrics_daily')
        .select(column)
        .eq('country_id', countryId)
        .not(column, 'is', null)
        .order('date', { ascending: true })

    if (window365) {
        const cutoff = format(subDays(new Date(), 365), 'yyyy-MM-dd')
        query = query.gte('date', cutoff)
    }

    const { data, error } = await query
    if (error) throw new Error(`Fetch failed for column ${column}: ${error.message}`)
    return (data ?? []).map((row: any) => row[column] as number)
}

async function main() {
    console.log('📐 Computing normalization parameters (p5/p95)...\n')
    console.log('  Method: p5_p95_clamped')
    console.log('  Crypto window: 365 days | All others: full history\n')

    const { data: countries, error } = await supabase.from('countries').select('id, iso2, name')
    if (error) throw new Error(`Failed to load countries: ${error.message}`)

    const today = format(new Date(), 'yyyy-MM-dd')
    const oneYearAgo = format(subDays(new Date(), 365), 'yyyy-MM-dd')

    const results: any[] = []

    for (const country of countries!) {
        console.log(`\n📊 ${country.name} (${country.iso2})`)
        const params: any[] = []

        for (const [metricName, config] of Object.entries(METRIC_CONFIG) as [MetricName, { column: string; window365: boolean }][]) {
            const values = await fetchMetricValues(country.id, config.column, config.window365)

            if (values.length < 10) {
                console.log(`  ⚠️  ${metricName}: only ${values.length} values — skipping (insufficient data)`)
                continue
            }

            const p5 = percentile(values, 5)
            const p95 = percentile(values, 95)

            console.log(
                `  ✓ ${metricName.padEnd(16)} n=${String(values.length).padEnd(5)} p5=${p5.toFixed(4).padEnd(10)} p95=${p95.toFixed(4)}`
            )

            params.push({
                country_id: country.id,
                metric_name: metricName,
                min_val: p5,
                max_val: p95,
                percentile_method: 'p5_p95_clamped',
                window_start: config.window365 ? oneYearAgo : '2019-01-01',
                window_end: today,
            })
        }

        results.push(...params)
    }

    console.log(`\n💾 Upserting ${results.length} normalization_params rows...`)

    const { error: upsertErr } = await supabase
        .from('normalization_params')
        .upsert(results, { onConflict: 'country_id,metric_name' })

    if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`)

    console.log('✅ Normalization params committed to DB.\n')

    // Print final summary table
    console.log('─'.repeat(80))
    console.log('NORMALIZATION PARAMS SUMMARY (validate manually):')
    console.log('─'.repeat(80))
    console.log(
        'Country'.padEnd(12) +
        'Metric'.padEnd(18) +
        'N'.padEnd(6) +
        'Min (p5)'.padEnd(14) +
        'Max (p95)'.padEnd(14) +
        'Window'
    )
    console.log('─'.repeat(80))

    for (const r of results) {
        const country = countries!.find((c) => c.id === r.country_id)
        console.log(
            (country?.iso2 ?? '??').padEnd(12) +
            r.metric_name.padEnd(18) +
            '—'.padEnd(6) +
            r.min_val.toFixed(4).padEnd(14) +
            r.max_val.toFixed(4).padEnd(14) +
            r.window_start + ' → ' + r.window_end
        )
    }

    console.log('─'.repeat(80))
    console.log('\n🎉 Done. Validate the table above before running the cron pipeline.')
}

main()
