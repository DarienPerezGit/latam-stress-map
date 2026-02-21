'use client'

import React, { useEffect, useState } from 'react'
import StressMap from '@/components/StressMap'

const REFRESH_INTERVAL = 3600000 // 1 hour

export default function Home() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  if (loading) {
    return (
      <main className="container">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <div className="animate-fade-in" style={{ opacity: 0.5 }}>Cargando termómetro...</div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="container">
        <div className="glass" style={{ padding: '2rem', textAlign: 'center', color: 'var(--stress-crit)' }}>
          Error: {error}
        </div>
      </main>
    )
  }

  return (
    <main className="container">
      <header style={{ marginBottom: '3rem', textAlign: 'center' }} className="animate-fade-in">
        <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>Macro Stress Map</h1>
        <p style={{ opacity: 0.6, fontSize: '1.2rem' }}>
          Real-time pressure monitor for Latin American economies
        </p>
      </header>

      <div className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <StressMap data={data} />
      </div>

      <footer style={{ marginTop: '4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '2rem' }} className="animate-fade-in">
        <div className="glass" style={{ padding: '1.5rem', display: 'flex', gap: '2rem' }}>
          <LegendItem color="var(--stress-low)" label="Low" range="0-20" />
          <LegendItem color="var(--stress-mid)" label="Mid" range="20-50" />
          <LegendItem color="var(--stress-high)" label="High" range="50-80" />
          <LegendItem color="var(--stress-crit)" label="Critical" range="80+" />
        </div>

        <div style={{ textAlign: 'right' }}>
          <p style={{ opacity: 0.4, fontSize: '0.875rem' }}>
            Last Update: {data[0]?.date ? new Date(data[0].date).toLocaleDateString() : '--'}
          </p>
          <p style={{ opacity: 0.6, marginTop: '0.5rem' }}>
            Data: FX Vol (30%), Inflation (20%), Sov Risk (20%), Crypto (15%), Reserves (15%)
          </p>
        </div>
      </footer>
    </main>
  )
}

function LegendItem({ color, label, range }: { color: string; label: string; range: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: color }} />
        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{label}</span>
      </div>
      <span style={{ opacity: 0.4, fontSize: '0.75rem', marginLeft: '1.25rem' }}>{range}</span>
    </div>
  )
}
