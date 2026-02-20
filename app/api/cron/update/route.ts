/**
 * /api/cron/update — Vercel Cron Job entrypoint
 *
 * Schedule: daily at 09:00 UTC (set in vercel.json)
 * Auth: CRON_SECRET header (Vercel injects automatically)
 *
 * This is a thin wrapper around runDailyUpdate() in lib/cron/update.ts.
 * All logic lives in the lib — this file is just the HTTP boundary.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { runDailyUpdate } from '../../../../lib/cron/update'

// Allow up to 5 minutes for the full pipeline (Vercel Pro limit)
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    // ── Auth: verify Vercel cron secret ────────────────────────────────────────
    // Vercel injects Authorization: Bearer <CRON_SECRET> automatically.
    // Also allow the raw CRON_SECRET header for local testing via curl.
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        // Allow localhost without auth for convenience during development
        const host = req.headers.get('host') ?? ''
        const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')
        if (!isLocal) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
    }

    try {
        const result = await runDailyUpdate()

        const httpStatus =
            result.status === 'error' ? 500 :
                result.status === 'partial' ? 207 : 200

        return NextResponse.json(result, { status: httpStatus })
    } catch (err: any) {
        console.error('[/api/cron/update] Unhandled error:', err)
        return NextResponse.json(
            { error: 'Internal server error', message: err.message },
            { status: 500 }
        )
    }
}
