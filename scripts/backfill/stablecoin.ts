/**
 * Backfill: Stablecoin Premium normalization params (AR only)
 *
 * Since we're bootstrapping the stablecoin_premium metric and have no
 * historical P2P data yet, we use arg_blue_gap as a proxy distribution.
 * Both measure the same underlying signal: the spread between the
 * official FX rate and the parallel/crypto market rate for USD in Argentina.
 *
 * This script:
 *   1. Loads the country_id for Argentina ('AR')
 *   2. Reads all historical arg_blue_gap values from metrics_daily
 *   3. Computes p5 and p95 of that distribution
 *   4. Upserts a normalization_params row for (AR, 'stablecoin_premium')
 *
 * Once real stablecoin_premium data accumulates (~90+ days), re-run
 * compute-normalization.ts with the new metric to replace these proxy bounds.
 *
 * Usage: pnpm tsx scripts/backfill/stablecoin.ts
 */
import * as dotenv from 'dotenv'
import { supabase } from '../../lib/supabase'
import { percentile } from '../../lib/utils/rolling'

dotenv.config({ path: '.env.local' })

async function main() {
    console.log('[backfill/stablecoin] Starting...')

    // ── 1. Get Argentina country_id ─────────────────────────────────────────
    const { data: country, error: countryErr } = await supabase
        .from('countries')
        .select('id, iso2')
        .eq('iso2', 'AR')
        .single()

    if (countryErr || !country) {
        console.error('[backfill/stablecoin] Failed to find AR country:', countryErr?.message)
        process.exit(1)
    }

    const countryId = country.id
    console.log(`[backfill/stablecoin] AR country_id = ${countryId}`)

    // ── 2. Read all historical arg_blue_gap values ──────────────────────────
    const { data: rows, error: fetchErr } = await supabase
        .from('metrics_daily')
        .select('date, arg_blue_gap')
        .eq('country_id', countryId)
        .not('arg_blue_gap', 'is', null)
        .order('date', { ascending: true })

    if (fetchErr) {
        console.error('[backfill/stablecoin] Failed to fetch arg_blue_gap history:', fetchErr.message)
        process.exit(1)
    }

    const values = (rows ?? []).map(r => r.arg_blue_gap as number).filter(v => v != null)

    if (values.length < 5) {
        console.error(`[backfill/stablecoin] Not enough data points: ${values.length} (need at least 5)`)
        process.exit(1)
    }

    console.log(`[backfill/stablecoin] Found ${values.length} arg_blue_gap data points`)
    console.log(`  Range: [${Math.min(...values).toFixed(2)}, ${Math.max(...values).toFixed(2)}]`)

    // ── 3. Compute p5 / p95 ─────────────────────────────────────────────────
    const p5 = percentile(values, 5)
    const p95 = percentile(values, 95)

    console.log(`[backfill/stablecoin] p5  = ${p5.toFixed(4)}`)
    console.log(`[backfill/stablecoin] p95 = ${p95.toFixed(4)}`)

    if (p5 >= p95) {
        console.error(`[backfill/stablecoin] Degenerate distribution: p5 (${p5}) >= p95 (${p95}). Aborting.`)
        process.exit(1)
    }

    // ── 4. Determine window bounds from the data ────────────────────────────
    const windowStart = rows![0].date
    const windowEnd = rows![rows!.length - 1].date

    // ── 5. Upsert normalization_params ──────────────────────────────────────
    const { error: upsertErr } = await supabase
        .from('normalization_params')
        .upsert(
            {
                country_id: countryId,
                metric_name: 'stablecoin_premium',
                min_val: Math.round(p5 * 10000) / 10000,
                max_val: Math.round(p95 * 10000) / 10000,
                percentile_method: 'p5_p95_clamped',
                window_start: windowStart,
                window_end: windowEnd,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'country_id,metric_name' }
        )

    if (upsertErr) {
        console.error('[backfill/stablecoin] Upsert failed:', upsertErr.message)
        process.exit(1)
    }

    console.log(`\n✅ normalization_params upserted:`)
    console.log(`   country_id:  ${countryId} (AR)`)
    console.log(`   metric_name: stablecoin_premium`)
    console.log(`   min_val:     ${p5.toFixed(4)} (p5)`)
    console.log(`   max_val:     ${p95.toFixed(4)} (p95)`)
    console.log(`   window:      ${windowStart} → ${windowEnd}`)
    console.log(`   method:      p5_p95_clamped (proxy from arg_blue_gap)`)
}

main().catch((err) => {
    console.error('[backfill/stablecoin] Unexpected error:', err)
    process.exit(1)
})
