'use client'

import React from 'react'
import styles from './StressMap.module.css'

interface CountryStress {
    country: string
    iso2: string
    stress_score: number
    rank: number
    components: Record<string, number | null>
    partial: boolean
}

interface StressMapProps {
    data: CountryStress[]
}

const StressMap: React.FC<StressMapProps> = ({ data }) => {
    const getStressColor = (score: number) => {
        if (score < 20) return 'var(--stress-low)'
        if (score < 50) return 'var(--stress-mid)'
        if (score < 80) return 'var(--stress-high)'
        return 'var(--stress-crit)'
    }

    return (
        <div className={styles.container}>
            <div className={styles.grid}>
                {data.map((c) => (
                    <div key={c.iso2} className={`${styles.node} glass animate-fade-in`}>
                        <div className={styles.header}>
                            <span className={styles.iso}>{c.iso2}</span>
                            <span className={styles.rank}>#{c.rank}</span>
                        </div>

                        <div className={styles.scoreContainer}>
                            <div
                                className={styles.scoreCircle}
                                style={{ '--color': getStressColor(c.stress_score) } as any}
                            >
                                <span className={styles.scoreValue}>{c.stress_score.toFixed(1)}</span>
                            </div>
                        </div>

                        <div className={styles.footer}>
                            <h3 className={styles.name}>{c.country}</h3>
                            <div className={styles.dot} style={{ background: getStressColor(c.stress_score) }} />
                        </div>

                        {c.partial && (
                            <div className={styles.partialBadge} title="Partial data available">
                                ⚠️
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

export default StressMap
