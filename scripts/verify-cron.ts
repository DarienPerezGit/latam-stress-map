/**
 * Quick verification: check pipeline_log and latest stress scores.
 * Usage: pnpm tsx scripts/verify-cron.ts
 */
import { supabase } from '../lib/supabase'

async function main() {
    // 1. Pipeline log
    const { data: logs } = await supabase
        .from('pipeline_log')
        .select('run_date, status, duration_ms, detail')
        .order('created_at', { ascending: false })
        .limit(3)

    console.log('\n📋 PIPELINE LOG (last 3 runs):')
    console.log('─'.repeat(70))
    for (const log of logs ?? []) {
        console.log(`  ${log.run_date} | ${log.status.toUpperCase()} | ${log.duration_ms}ms`)
        if (log.detail && typeof log.detail === 'object') {
            const detail = log.detail as any
            for (const [k, v] of Object.entries(detail)) {
                if (k !== 'errors' && typeof v === 'object') {
                    const s = (v as any).stress_score
                    const w = (v as any).available_weight
                    if (s !== undefined) console.log(`    ${k}: score=${s} | weight=${w}`)
                }
            }
        }
    }

    // 2. Latest stress scores
    const { data: scores } = await supabase
        .from('metrics_daily')
        .select('date, country_id, stress_score, fx_vol, inflation, risk_spread, crypto_ratio, reserves_change, data_flags')
        .not('stress_score', 'is', null)
        .order('date', { ascending: false })
        .limit(12)

    const { data: countries } = await supabase.from('countries').select('id, iso2')
    const countryMap = Object.fromEntries((countries ?? []).map((c) => [c.id, c.iso2]))

    console.log('\n📊 LATEST STRESS SCORES:')
    console.log('─'.repeat(70))
    console.log('Country  | Score | fx_vol | inflation | risk_spread | crypto | reserves')
    console.log('─'.repeat(70))
    const seen = new Set<number>()
    for (const row of scores ?? []) {
        if (seen.has(row.country_id)) continue
        seen.add(row.country_id)
        const iso2 = countryMap[row.country_id] ?? '??'
        const flags = (row.data_flags ?? {}) as any
        console.log(
            `${iso2.padEnd(9)}| ${String(row.stress_score ?? '--').padEnd(6)}` +
            `| ${String(row.fx_vol?.toFixed(4) ?? '--').padEnd(7)}` +
            `| ${String(row.inflation?.toFixed(2) ?? '--').padEnd(10)}` +
            `| ${String(row.risk_spread?.toFixed(2) ?? '--').padEnd(12)}` +
            `| ${String(row.crypto_ratio?.toFixed(4) ?? '--').padEnd(7)}` +
            `| ${row.reserves_change?.toFixed(2) ?? '--'}`
        )
    }
    console.log('─'.repeat(70))
    console.log('\nDone.')
}

main()
