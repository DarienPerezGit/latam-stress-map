'use client'

import React from 'react'
import { getStressColor, getStressLevel } from './countryData'

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

interface TooltipProps {
    country: CountryStress | null
    visible: boolean
}

const COMPONENT_LABELS: Record<string, string> = {
    fx_vol: 'FX Volatility',
    inflation: 'Inflation',
    risk_spread: 'Sovereign Risk',
    crypto_ratio: 'Crypto Ratio',
    reserves_change: 'Reserves Δ',
}

export default function Tooltip({ country, visible }: TooltipProps) {
    if (!country) return null

    const color = getStressColor(country.stress_score)
    const level = getStressLevel(country.stress_score)
    const isCritical = country.stress_score >= 80

    return (
        <div className={`globe-tooltip ${visible ? 'visible' : ''}`}>
            <div className="tooltip-header">
                <span className="tooltip-country">{country.country}</span>
                <span className="tooltip-iso">{country.iso2}</span>
            </div>

            <div className="tooltip-score-row">
                <span className="tooltip-label">STRESS</span>
                <span
                    className={`tooltip-score ${isCritical ? 'pulse-text' : ''}`}
                    style={{ color }}
                >
                    {country.stress_score.toFixed(1)}
                </span>
                <span className="tooltip-level" style={{ color }}>{level}</span>
            </div>

            {(country.delta_7d != null || country.delta_30d != null) && (
                <div className="tooltip-deltas">
                    {country.delta_7d != null && (
                        <span className={`tooltip-delta ${country.delta_7d > 0 ? 'up' : 'down'}`}>
                            7d: {country.delta_7d > 0 ? '+' : ''}{country.delta_7d.toFixed(1)}
                        </span>
                    )}
                    {country.delta_30d != null && (
                        <span className={`tooltip-delta ${country.delta_30d > 0 ? 'up' : 'down'}`}>
                            30d: {country.delta_30d > 0 ? '+' : ''}{country.delta_30d.toFixed(1)}
                        </span>
                    )}
                </div>
            )}

            <div className="tooltip-divider" />

            <div className="tooltip-components">
                {Object.entries(country.components).map(([key, value]) => (
                    <div key={key} className="tooltip-component-row">
                        <span className="tooltip-comp-label">{COMPONENT_LABELS[key] || key}</span>
                        <span className="tooltip-comp-value">
                            {value != null ? value.toFixed(1) : '—'}
                        </span>
                    </div>
                ))}
            </div>

            <div className="tooltip-rank">
                RANK #{country.rank}
            </div>
        </div>
    )
}
