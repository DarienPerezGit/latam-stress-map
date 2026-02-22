'use client'

import React, { useMemo } from 'react'

interface SparklineChartProps {
    data: (number | null)[]
    color?: string
    width?: number
    height?: number
    label?: string
    showValue?: boolean
}

/**
 * Minimalist SVG sparkline with cyberpunk glow.
 * Maps data points to a polyline + gradient fill inside a fixed viewBox.
 */
export default function SparklineChart({
    data,
    color = '#4488cc',
    width = 120,
    height = 32,
    label,
    showValue = true,
}: SparklineChartProps) {
    // Filter out nulls to get plottable values
    const points = useMemo(() => data.filter((v): v is number => v !== null), [data])

    const { polyline, areaPath, lastValue } = useMemo(() => {
        if (points.length < 2) return { polyline: '', areaPath: '', lastValue: null }

        const min = Math.min(...points)
        const max = Math.max(...points)
        const range = max - min || 1 // prevent division by zero

        const padX = 2
        const padY = 4
        const plotW = width - padX * 2
        const plotH = height - padY * 2

        const coords = points.map((v, i) => {
            const x = padX + (i / (points.length - 1)) * plotW
            const y = padY + (1 - (v - min) / range) * plotH
            return { x, y }
        })

        const polyline = coords.map(p => `${p.x},${p.y}`).join(' ')

        // Area fill: close path at bottom
        const areaPath = [
            `M ${coords[0].x},${coords[0].y}`,
            ...coords.slice(1).map(p => `L ${p.x},${p.y}`),
            `L ${coords[coords.length - 1].x},${height}`,
            `L ${coords[0].x},${height}`,
            'Z',
        ].join(' ')

        return { polyline, areaPath, lastValue: points[points.length - 1] }
    }, [points, width, height])

    if (points.length < 2) {
        return (
            <div className="sparkline-row">
                {label && <span className="sparkline-label">{label}</span>}
                <span className="sparkline-no-data">NO DATA</span>
            </div>
        )
    }

    // Unique filter ID per component to avoid SVG conflicts
    const filterId = `glow-${label?.replace(/\s/g, '') ?? 'spark'}`
    const gradientId = `fill-${label?.replace(/\s/g, '') ?? 'spark'}`

    return (
        <div className="sparkline-row">
            {label && <span className="sparkline-label">{label}</span>}
            <svg
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                className="sparkline-svg"
            >
                <defs>
                    <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="1.5" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                </defs>

                {/* Fill area under the curve */}
                <path d={areaPath} fill={`url(#${gradientId})`} />

                {/* Glowing line */}
                <polyline
                    points={polyline}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter={`url(#${filterId})`}
                />

                {/* End dot */}
                <circle
                    cx={2 + ((points.length - 1) / (points.length - 1)) * (width - 4)}
                    cy={4 + (1 - (points[points.length - 1] - Math.min(...points)) / (Math.max(...points) - Math.min(...points) || 1)) * (height - 8)}
                    r="2"
                    fill={color}
                />
            </svg>
            {showValue && lastValue !== null && (
                <span className="sparkline-value" style={{ color }}>
                    {lastValue.toFixed(1)}
                </span>
            )}
        </div>
    )
}
