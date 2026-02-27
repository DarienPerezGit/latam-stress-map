'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { track } from '@vercel/analytics'
import { getStressColor, getStressLevel } from './countryData'
import SparklineChart from './SparklineChart'

interface CountryStress {
    country: string
    iso2: string
    stress_score: number
    rank: number
    components: Record<string, number | null>
    partial: boolean
    delta_7d?: number | null
    delta_30d?: number | null
}

interface HistoryPoint {
    date: string
    stress_score: number
    components: Record<string, number | null>
}

interface SidePanelProps {
    data: CountryStress[]
    selectedIso: string | null
    onSelectCountry: (iso2: string | null) => void
}

// Metric display config
const METRIC_CONFIG = [
    { key: 'fx_vol', label: 'FX Volatility', color: '#4488cc' },
    { key: 'inflation', label: 'Inflation', color: '#f59e0b' },
    { key: 'risk_spread', label: 'Sovereign Risk', color: '#ef4444' },
    { key: 'crypto_ratio', label: 'Crypto Hedge', color: '#8b5cf6' },
    { key: 'reserves_change', label: 'Reserves', color: '#10b981' },
    { key: 'stablecoin_premium', label: 'Stablecoin Premium', color: '#06b6d4' },
]

const MAX_VISIBLE = 10

export default function SidePanel({ data, selectedIso, onSelectCountry }: SidePanelProps) {
    const selectedCountry = selectedIso
        ? data.find(c => c.iso2 === selectedIso) ?? null
        : null

    if (selectedCountry) {
        return (
            <DetailView
                country={selectedCountry}
                onBack={() => onSelectCountry(null)}
            />
        )
    }

    return <RankingView data={data} onSelectCountry={onSelectCountry} />
}

// ─── Ranking View (default) ─────────────────────────────────────────────────

function RankingView({
    data,
    onSelectCountry,
}: {
    data: CountryStress[]
    onSelectCountry: (iso2: string) => void
}) {
    const ranked = data.length <= MAX_VISIBLE ? data : data.slice(0, MAX_VISIBLE)

    return (
        <div className="side-panel">
            <div className="side-panel-header">
                <div className="side-panel-indicator" />
                <span className="side-panel-title">STRESS INDEX</span>
            </div>

            <div className="side-panel-divider" />

            <div className="side-panel-list">
                {ranked.map((c, i) => {
                    const color = getStressColor(c.stress_score)
                    const level = getStressLevel(c.stress_score)
                    const isCritical = c.stress_score >= 80

                    return (
                        <div
                            key={c.iso2}
                            className={`side-panel-row ${isCritical ? 'critical' : ''}`}
                            style={{ animationDelay: `${0.5 + i * 0.1}s`, cursor: 'pointer' }}
                            onClick={() => {
                                track('country_selected', { iso2: c.iso2, score: c.stress_score, level, rank: c.rank })
                                onSelectCountry(c.iso2)
                            }}
                        >
                            <div className="side-panel-rank">#{c.rank}</div>
                            <div className="side-panel-iso">{c.iso2}</div>
                            <div className="side-panel-score" style={{ color }}>
                                {c.stress_score.toFixed(1)}
                            </div>
                            <div
                                className="side-panel-dot"
                                style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                            />
                            <div className="side-panel-level" style={{ color }}>
                                {level}
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="side-panel-divider" />

            <div className="side-panel-footer">
                <span>LATAM MACRO MONITOR</span>
                <span className="side-panel-live">
                    <span className="side-panel-live-dot" />
                    LIVE
                </span>
            </div>
        </div>
    )
}

// ─── Detail View (sparklines) ───────────────────────────────────────────────

function DetailView({
    country,
    onBack,
}: {
    country: CountryStress
    onBack: () => void
}) {
    const [history, setHistory] = useState<HistoryPoint[] | null>(null)
    const [loading, setLoading] = useState(true)

    const fetchHistory = useCallback(async (iso2: string) => {
        setLoading(true)
        try {
            const res = await fetch(`/api/public/stress/${iso2}/history`)
            if (!res.ok) throw new Error('Failed to fetch history')
            const json = await res.json()
            setHistory(json)
        } catch (err) {
            console.warn('History fetch failed:', err)
            setHistory([])
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchHistory(country.iso2)
    }, [country.iso2, fetchHistory])

    const color = getStressColor(country.stress_score)
    const level = getStressLevel(country.stress_score)

    function handleShare() {
        const delta = country.delta_7d != null
            ? ` (${country.delta_7d > 0 ? '+' : ''}${country.delta_7d.toFixed(1)} in 7d)`
            : ''
        const text = `${country.country} macro stress: ${country.stress_score.toFixed(1)} ${level}${delta}`
        const url = `https://latam-stress-map.vercel.app/api/snapshot/${country.iso2}`
        const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
        track('share_clicked', { iso2: country.iso2, score: country.stress_score, level })
        window.open(tweet, '_blank', 'noopener,noreferrer')
    }

    return (
        <div className="side-panel side-panel-detail">
            {/* Back button + Share button */}
            <div className="detail-nav">
                <button className="detail-back" onClick={onBack}>
                    ← RANKING
                </button>
                <button className="detail-share" onClick={handleShare}>
                    SHARE ↗
                </button>
            </div>

            {/* Country header */}
            <div className="detail-header">
                <div className="detail-name">{country.country}</div>
                <div className="detail-score-row">
                    <span className="detail-score" style={{ color }}>
                        {country.stress_score.toFixed(1)}
                    </span>
                    <span className="detail-badge" style={{ background: color }}>
                        {level}
                    </span>
                </div>
                {/* Deltas */}
                <div className="detail-deltas">
                    {country.delta_7d != null && (
                        <span className={`detail-delta ${country.delta_7d > 0 ? 'up' : 'down'}`}>
                            7d: {country.delta_7d > 0 ? '+' : ''}{country.delta_7d.toFixed(1)}
                        </span>
                    )}
                    {country.delta_30d != null && (
                        <span className={`detail-delta ${country.delta_30d > 0 ? 'up' : 'down'}`}>
                            30d: {country.delta_30d > 0 ? '+' : ''}{country.delta_30d.toFixed(1)}
                        </span>
                    )}
                </div>
            </div>

            <div className="side-panel-divider" />

            {/* Sparklines */}
            <div className="detail-sparklines">
                <div className="detail-title">30-DAY TRENDS</div>
                {loading ? (
                    <div className="detail-loading">LOADING...</div>
                ) : (
                    METRIC_CONFIG.map(({ key, label, color: metricColor }) => {
                        const currentValue = country.components[key] ?? null
                        const series = history?.map(h => h.components[key] ?? null) ?? []
                        const hasAnyData = currentValue !== null || series.some(v => v !== null)

                        // Don't render the row at all if this metric has no data for this country
                        // (e.g. stablecoin_premium is null for all non-AR countries)
                        if (!hasAnyData) return null

                        return (
                            <SparklineChart
                                key={key}
                                data={series}
                                color={metricColor}
                                label={label}
                                width={120}
                                height={28}
                            />
                        )
                    })
                )}

                {/* Overall stress sparkline */}
                {!loading && history && history.length > 0 && (
                    <>
                        <div className="side-panel-divider" />
                        <SparklineChart
                            data={history.map(h => h.stress_score)}
                            color={color}
                            label="Overall"
                            width={120}
                            height={32}
                        />
                    </>
                )}
            </div>

            <div className="side-panel-divider" />

            <div className="side-panel-footer">
                <span>LATAM MACRO MONITOR</span>
                <span className="side-panel-live">
                    <span className="side-panel-live-dot" />
                    LIVE
                </span>
            </div>
        </div>
    )
}
