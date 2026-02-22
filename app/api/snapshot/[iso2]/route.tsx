/**
 * /api/snapshot/[iso2] — Viral OG image card (1200×630)
 *
 * Edge runtime: renders in ~80ms via next/og (Satori).
 * No internal HTTP fetch — queries Supabase directly via shared lib.
 *
 * Usage:
 *   GET /api/snapshot/BR
 *   → PNG suitable for Twitter/OG card unfurling
 */
import { ImageResponse } from 'next/og'
import { getCountrySnapshot, getCountryHistory } from '../../../../lib/queries/snapshot'

export const runtime = 'edge'

const APP_URL = 'https://macrostressmap.vercel.app'

// ── Color palette (matches War Room exactly) ────────────────────────────────
function getStressColor(score: number): string {
    if (score < 30) return '#10b981'
    if (score < 60) return '#f59e0b'
    if (score < 80) return '#f97316'
    return '#ef4444'
}

function getStressLevel(score: number): string {
    if (score < 30) return 'LOW'
    if (score < 60) return 'MODERATE'
    if (score < 80) return 'HIGH'
    return 'CRITICAL'
}

// ── Sparkline SVG → base64 data URI ─────────────────────────────────────────
// Satori doesn't render native <polyline> — embed as <img> w/ data URI instead.
function buildSparklineDataURI(scores: number[], color: string): string {
    const W = 580
    const H = 80
    const padX = 4
    const padY = 8

    const values = scores.filter(v => v != null && !isNaN(v))
    if (values.length < 2) return ''

    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1

    const plotW = W - padX * 2
    const plotH = H - padY * 2

    const coords = values.map((v, i) => {
        const x = padX + (i / (values.length - 1)) * plotW
        const y = padY + (1 - (v - min) / range) * plotH
        return { x, y }
    })

    const polyline = coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

    // Area fill path
    const areaPath = [
        `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`,
        ...coords.slice(1).map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
        `L ${coords[coords.length - 1].x.toFixed(1)},${H}`,
        `L ${coords[0].x.toFixed(1)},${H} Z`,
    ].join(' ')

    // Hex color → rgba for fill
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="${areaPath}" fill="url(#g)"/>
  <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${coords[coords.length - 1].x.toFixed(1)}" cy="${coords[coords.length - 1].y.toFixed(1)}" r="4" fill="${color}"/>
</svg>`

    const b64 = Buffer.from(svg).toString('base64')
    return `data:image/svg+xml;base64,${b64}`
}

// ── Route Handler ────────────────────────────────────────────────────────────
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ iso2: string }> }
) {
    const { iso2 } = await params

    // Load fonts in parallel with data
    const [interBold, monoRegular, snapshot, history] = await Promise.all([
        fetch(
            'https://fonts.gstatic.com/s/spacegrotesk/v16/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gozuEnL.woff'
        ).then(r => r.arrayBuffer()),
        fetch(
            'https://fonts.gstatic.com/s/spacemono/v13/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff'
        ).then(r => r.arrayBuffer()),
        getCountrySnapshot(iso2),
        getCountryHistory(iso2),
    ])

    // Fallback card for unknown/no-data country
    if (!snapshot) {
        return new ImageResponse(
            (
                <div
                    style= {{
            width: '1200px',
            height: '630px',
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: 'SpaceMono',
            fontSize: '24px',
            letterSpacing: '0.2em',
        }}
                >
        COUNTRY NOT FOUND — { iso2.toUpperCase() }
    </div>
            ),
    { width: 1200, height: 630 }
        )
}

const { country, stress_score, rank, delta_7d, delta_30d, date } = snapshot
const color = getStressColor(stress_score)
const level = getStressLevel(stress_score)
const scores = history.map(h => h.stress_score)
const sparklineURI = buildSparklineDataURI(scores, color)

const formattedDate = new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
})

const deltaSign = (v: number) => (v > 0 ? '+' : '')
const hasDelta7 = delta_7d != null
const hasDelta30 = delta_30d != null

return new ImageResponse(
    (
        <div
                style= {{
    width: '1200px',
    height: '630px',
    background: '#000000',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'SpaceMono',
    padding: '0',
    overflow: 'hidden',
}}
            >
    {/* Subtle grid background */ }
    < div
                    style = {{
    position: 'absolute',
    inset: '0',
    backgroundImage:
        'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
    backgroundSize: '60px 60px',
    display: 'flex',
}}
                />

                {/* Top accent bar */ }
    < div
                    style = {{
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    height: '3px',
    background: `linear-gradient(90deg, ${color}, transparent)`,
    display: 'flex',
}}
                />

                {/* Header row */ }
    < div
                    style = {{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '36px 64px 0px 64px',
    position: 'relative',
}}
                >
    <span
                        style={{
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
    letterSpacing: '0.22em',
}}
                    >
    LATAM MACRO STRESS MONITOR
    </span>
< span
                        style = {{
    color: 'rgba(255,255,255,0.25)',
    fontSize: '13px',
    letterSpacing: '0.15em',
}}
                    >
                        #{ rank } REGIONAL RANKING
</span>
</div>

                {/* Main body */ }
    < div
                    style = {{
    display: 'flex',
    flexDirection: 'column',
    padding: '48px 64px 0px 64px',
    flex: '1',
    position: 'relative',
}}
                >
    {/* Country name */ }
    < div
                        style = {{
    color: 'rgba(255,255,255,0.9)',
    fontSize: '32px',
    letterSpacing: '0.25em',
    marginBottom: '16px',
}}
                    >
    { country.toUpperCase() }
    </div>

                    {/* Score + badge */ }
    < div
                        style = {{
    display: 'flex',
    alignItems: 'baseline',
    gap: '24px',
    marginBottom: '24px',
}}
                    >
    <span
                            style={{
    fontFamily: 'SpaceGrotesk',
    fontSize: '120px',
    fontWeight: '700',
    color,
    lineHeight: '1',
    letterSpacing: '-0.03em',
}}
                        >
    { stress_score.toFixed(1) }
    </span>
    < div
                            style = {{
    background: color,
    color: 'rgba(0,0,0,0.9)',
    fontSize: '14px',
    letterSpacing: '0.2em',
    fontWeight: '700',
    padding: '6px 16px',
    borderRadius: '4px',
    marginBottom: '8px',
    display: 'flex',
}}
                        >
    { level }
    </div>
    </div>

                    {/* Deltas */ }
    < div
                        style = {{
    display: 'flex',
    gap: '32px',
    marginBottom: '32px',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '16px',
    letterSpacing: '0.1em',
}}
                    >
    { hasDelta7 && (
        <span style={{ color: delta_7d! > 0 ? '#ef4444' : '#10b981' }}>
7d{ '\u00A0'}{ deltaSign(delta_7d!) }{ delta_7d!.toFixed(1) }
</span>
)}
{
    hasDelta30 && (
        <span style={ { color: delta_30d! > 0 ? '#ef4444' : '#10b981' } }>
            30d{ '\u00A0' } { deltaSign(delta_30d!) } { delta_30d!.toFixed(1) }
    </span>
                        )
}
{
    !hasDelta7 && !hasDelta30 && (
        <span>NO HISTORICAL DELTA </span>
                        )
}
</div>

{/* Sparkline */ }
{
    sparklineURI && (
        <div style={ { display: 'flex', flexDirection: 'column', gap: '6px' } }>
            <span
                                style={
        {
            color: 'rgba(255,255,255,0.2)',
                fontSize: '11px',
                    letterSpacing: '0.2em',
                                }
    }
                            >
        30 - DAY TREND
            </span>
    {/* eslint-disable-next-line @next/next/no-img-element */ }
    <img
                                src={ sparklineURI }
    width = { 580}
    height = { 80}
    alt = "30-day stress trend"
    style = {{ display: 'flex' }
}
                            />
    </div>
                    )}
</div>

{/* Footer */ }
<div
                    style={
    {
        display: 'flex',
            justifyContent: 'space-between',
                alignItems: 'center',
                    padding: '24px 64px 36px 64px',
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                            position: 'relative',
                    }
}
                >
    <span
                        style={
    {
        color,
            fontSize: '13px',
                letterSpacing: '0.15em',
                        }
}
                    >
    { APP_URL }
    </span>
    < span
style = {{
    color: 'rgba(255,255,255,0.2)',
        fontSize: '12px',
            letterSpacing: '0.12em',
                        }}
                    >
    UPDATED { formattedDate.toUpperCase() }
</span>
    </div>
    </div>
        ),
{
    width: 1200,
        height: 630,
            fonts: [
                {
                    name: 'SpaceGrotesk',
                    data: interBold,
                    weight: 700,
                    style: 'normal',
                },
                {
                    name: 'SpaceMono',
                    data: monoRegular,
                    weight: 400,
                    style: 'normal',
                },
            ],
        }
    )
}
