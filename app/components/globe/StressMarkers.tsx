'use client'

import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { LATAM_COUNTRIES, latLngToSphere, getStressColor } from './countryData'

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

interface StressMarkersProps {
    data: CountryStress[]
    globeRadius: number
    onHover: (country: CountryStress | null, position: THREE.Vector3 | null) => void
    onSelect?: (iso2: string) => void
}

/**
 * Procedural radial gradient texture — soft circular halo.
 * Generated once and shared across all markers.
 */
function createGlowTexture(): THREE.Texture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const center = size / 2
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.6)')
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.15)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
}

/**
 * Procedural ring alpha texture for shockwave.
 */
function createRingTexture(): THREE.Texture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const center = size / 2
    const gradient = ctx.createRadialGradient(center, center, center * 0.6, center, center, center)
    gradient.addColorStop(0, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)')
    gradient.addColorStop(0.6, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.8, 'rgba(255,255,255,0.8)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
}

// Shared textures (created lazily on first use)
let _glowTex: THREE.Texture | null = null
let _ringTex: THREE.Texture | null = null

function getGlowTexture() {
    if (!_glowTex) _glowTex = createGlowTexture()
    return _glowTex
}
function getRingTexture() {
    if (!_ringTex) _ringTex = createRingTexture()
    return _ringTex
}

/**
 * Individual stress marker with core sphere, glow billboard, and shockwave ring.
 */
function StressMarker({
    country,
    position,
    color,
    isCritical,
    sizeFactor,
    onHover,
    onSelect,
}: {
    country: CountryStress
    position: [number, number, number]
    color: string
    isCritical: boolean
    sizeFactor: number
    onHover: StressMarkersProps['onHover']
    onSelect?: (iso2: string) => void
}) {
    const groupRef = useRef<THREE.Group>(null!)
    const glowRef = useRef<THREE.Mesh>(null!)
    const ringRef = useRef<THREE.Mesh>(null!)
    const coreRef = useRef<THREE.Mesh>(null!)

    const colorObj = useMemo(() => new THREE.Color(color), [color])
    const baseSize = 0.02 * sizeFactor

    const glowTexture = useMemo(() => getGlowTexture(), [])
    const ringTexture = useMemo(() => getRingTexture(), [])

    useFrame(({ clock }) => {
        if (!isCritical) return
        const t = clock.getElapsedTime()

        // Pulsating core
        if (coreRef.current) {
            const pulseScale = 1 + 0.3 * Math.sin(t * 3)
            coreRef.current.scale.setScalar(pulseScale)
        }

        // Breathing glow
        if (glowRef.current) {
            const glowScale = 1 + 0.4 * Math.sin(t * 2)
            glowRef.current.scale.setScalar(glowScale)
            const mat = glowRef.current.material as THREE.MeshBasicMaterial
            mat.opacity = 0.3 + 0.15 * Math.sin(t * 2.5)
        }

        // Expanding shockwave ring
        if (ringRef.current) {
            const cycle = (t * 0.8) % 2 // 2-second cycle
            const progress = cycle / 2
            const scale = 1 + progress * 4
            ringRef.current.scale.setScalar(scale)
            const mat = ringRef.current.material as THREE.MeshBasicMaterial
            mat.opacity = Math.max(0, 0.6 * (1 - progress))
        }
    })

    const worldPos = useMemo(() => new THREE.Vector3(...position), [position])

    return (
        <group
            ref={groupRef}
            position={position}
            onPointerOver={(e) => {
                e.stopPropagation()
                document.body.style.cursor = 'pointer'
                onHover(country, worldPos)
            }}
            onPointerOut={(e) => {
                e.stopPropagation()
                document.body.style.cursor = 'auto'
                onHover(null, null)
            }}
            onClick={(e) => {
                e.stopPropagation()
                onSelect?.(country.iso2)
            }}
        >
            {/* Core sphere */}
            <mesh ref={coreRef}>
                <sphereGeometry args={[baseSize, 16, 16]} />
                <meshStandardMaterial
                    color={colorObj}
                    emissive={colorObj}
                    emissiveIntensity={isCritical ? 2.5 : 1.5}
                    toneMapped={false}
                />
            </mesh>

            {/* Outer glow billboard — radial gradient alpha */}
            {/* raycast disabled: prevents transparent billboard from intercepting clicks */}
            <Billboard>
                <mesh ref={glowRef} raycast={() => null}>
                    <planeGeometry args={[baseSize * 8, baseSize * 8]} />
                    <meshBasicMaterial
                        color={colorObj}
                        map={glowTexture}
                        transparent
                        opacity={isCritical ? 0.45 : 0.25}
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                    />
                </mesh>
            </Billboard>

            {/* Shockwave ring (only for critical) — ring gradient alpha */}
            {/* raycast disabled: prevents transparent billboard from intercepting clicks */}
            {isCritical && (
                <Billboard>
                    <mesh ref={ringRef} raycast={() => null}>
                        <planeGeometry args={[baseSize * 8, baseSize * 8]} />
                        <meshBasicMaterial
                            color={colorObj}
                            map={ringTexture}
                            transparent
                            opacity={0.5}
                            depthWrite={false}
                            side={THREE.DoubleSide}
                            blending={THREE.AdditiveBlending}
                        />
                    </mesh>
                </Billboard>
            )}
        </group>
    )
}

/**
 * Renders all stress markers on the globe surface.
 */
export default function StressMarkers({ data, globeRadius, onHover, onSelect }: StressMarkersProps) {
    const markers = useMemo(() => {
        return data.map((country) => {
            const geo = LATAM_COUNTRIES.find((g) => g.iso2 === country.iso2)
            if (!geo) return null

            const position = latLngToSphere(geo.lat, geo.lng, globeRadius + 0.01)
            const color = getStressColor(country.stress_score)
            const isCritical = country.stress_score >= 80

            return {
                key: country.iso2,
                country,
                position,
                color,
                isCritical,
                sizeFactor: geo.area,
            }
        }).filter(Boolean) as {
            key: string
            country: CountryStress
            position: [number, number, number]
            color: string
            isCritical: boolean
            sizeFactor: number
        }[]
    }, [data, globeRadius])

    return (
        <group>
            {markers.map((m) => (
                <StressMarker
                    key={m.key}
                    country={m.country}
                    position={m.position}
                    color={m.color}
                    isCritical={m.isCritical}
                    sizeFactor={m.sizeFactor}
                    onHover={onHover}
                    onSelect={onSelect}
                />
            ))}
        </group>
    )
}
