'use client'

import React, { useEffect, useState, useCallback, Suspense } from 'react'
import dynamic from 'next/dynamic'
import SidePanel from './components/globe/SidePanel'
import Tooltip from './components/globe/Tooltip'

// Dynamic import for Three.js (SSR incompatible)
const GlobeScene = dynamic(() => import('./components/globe/GlobeScene'), {
  ssr: false,
  loading: () => <LoadingScreen />,
})

const REFRESH_INTERVAL = 3600000 // 1 hour

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

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-ring" />
        <div className="loading-text">INITIALIZING</div>
        <div className="loading-sub">Macro Stress Monitor</div>
      </div>
    </div>
  )
}

export default function Home() {
  const [data, setData] = useState<CountryStress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredCountry, setHoveredCountry] = useState<CountryStress | null>(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [selectedIso, setSelectedIso] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/public/stress')
        if (!res.ok) throw new Error('Failed to fetch data')
        const json = await res.json()
        setData(json)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
    const timer = setInterval(fetchData, REFRESH_INTERVAL)
    return () => clearInterval(timer)
  }, [])

  const handleHover = useCallback(
    (country: CountryStress | null) => {
      if (country) {
        setHoveredCountry(country)
        setTooltipVisible(true)
      } else {
        setTooltipVisible(false)
        // Delay clearing data so fade-out animation can play
        setTimeout(() => setHoveredCountry(null), 200)
      }
    },
    []
  )

  if (loading) {
    return <LoadingScreen />
  }

  if (error) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-text" style={{ color: '#ef4444' }}>ERROR</div>
          <div className="loading-sub">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <main className="globe-page">
      <Suspense fallback={<LoadingScreen />}>
        <GlobeScene
          data={data}
          onHover={(country) => handleHover(country)}
          onSelect={(iso2) => setSelectedIso(iso2)}
        />
      </Suspense>

      {/* HTML Overlays */}
      <div className="globe-overlays">
        {/* Title */}
        <div className="globe-title animate-slide-down">
          <h1>MACRO STRESS MAP</h1>
          <p>Latin America Real-Time Monitor</p>
        </div>

        {/* Side Panel */}
        <SidePanel
          data={data}
          selectedIso={selectedIso}
          onSelectCountry={setSelectedIso}
        />

        {/* Tooltip */}
        <Tooltip country={hoveredCountry} visible={tooltipVisible} />

        {/* Bottom Legend */}
        <div className="globe-legend animate-slide-up">
          <LegendDot color="#10b981" label="Low" range="0-30" />
          <LegendDot color="#f59e0b" label="Mid" range="30-60" />
          <LegendDot color="#f97316" label="High" range="60-80" />
          <LegendDot color="#ef4444" label="Critical" range="80+" />
        </div>
      </div>
    </main>
  )
}

function LegendDot({ color, label, range }: { color: string; label: string; range: string }) {
  return (
    <div className="legend-item">
      <div className="legend-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="legend-label">{label}</span>
      <span className="legend-range">{range}</span>
    </div>
  )
}
