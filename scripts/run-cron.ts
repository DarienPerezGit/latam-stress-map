import { runDailyUpdate } from '../lib/cron/update'

async function main() {
    console.log('🚀 Starting manual cron run...')
    const res = await runDailyUpdate()
    console.log(JSON.stringify(res, null, 2))
}

main().catch(console.error)
