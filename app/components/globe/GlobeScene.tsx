'use client'

import React, { useRef, useMemo, Suspense, useState, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Stars, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import StressMarkers from './StressMarkers'
import LatAmBorders from './LatAmBorders'

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

interface GlobeSceneProps {
    data: CountryStress[]
    onHover: (country: CountryStress | null, screenPos: { x: number; y: number } | null) => void
    onSelect?: (iso2: string) => void
}

const GLOBE_RADIUS = 1.5

// ─── Atmosphere Glow (Fresnel effect) ────────────────────────────────────────

function AtmosphereGlow() {
    const materialRef = useRef<THREE.ShaderMaterial>(null!)

    const vertexShader = `
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `

    const fragmentShader = `
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
      vec3 glowColor = vec3(0.15, 0.4, 0.9);
      gl_FragColor = vec4(glowColor, intensity * 0.6);
    }
  `

    return (
        <mesh scale={[1.15, 1.15, 1.15]}>
            <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
            <shaderMaterial
                ref={materialRef}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                transparent
                depthWrite={false}
                side={THREE.BackSide}
                blending={THREE.AdditiveBlending}
            />
        </mesh>
    )
}

// ─── Dark Cyberpunk Globe ────────────────────────────────────────────────────
// Pure visual component — NO rotation logic. Parent group in Scene handles rotation.

function CyberpunkGlobe() {
    const wireframeGeometry = useMemo(() => {
        const geo = new THREE.SphereGeometry(GLOBE_RADIUS + 0.002, 48, 24)
        return new THREE.WireframeGeometry(geo)
    }, [])

    return (
        <>
            {/* Solid dark sphere */}
            <mesh>
                <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
                <meshStandardMaterial
                    color="#0a0a0a"
                    roughness={0.9}
                    metalness={0.1}
                />
            </mesh>

            {/* Wireframe overlay */}
            <lineSegments geometry={wireframeGeometry}>
                <lineBasicMaterial
                    color="#1a3a5c"
                    transparent
                    opacity={0.12}
                    depthTest={true}
                />
            </lineSegments>

            {/* Country border outlines */}
            <LatAmBorders globeRadius={GLOBE_RADIUS} />
        </>
    )
}

// ─── Cinematic Camera Controller ─────────────────────────────────────────────

function CameraController({ yOffset = 0 }: { yOffset?: number }) {
    const { camera } = useThree()
    const startTime = useRef(Date.now())
    const introComplete = useRef(false)

    useFrame(() => {
        if (introComplete.current) return
        const elapsed = (Date.now() - startTime.current) / 1000
        const duration = 3 // seconds for intro zoom

        if (elapsed < duration) {
            const progress = elapsed / duration
            const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic

            // Zoom from 6 → 3.8
            const startDist = 6
            const endDist = 3.8
            const dist = startDist + (endDist - startDist) * eased

            // Position towards LatAm (slightly tilted)
            const targetLat = -15 * (Math.PI / 180)
            const targetLng = -60 * (Math.PI / 180)

            camera.position.set(
                dist * Math.cos(targetLat) * Math.sin(targetLng) * -1,
                dist * Math.sin(targetLat) * -0.3 + yOffset,
                dist * Math.cos(targetLat) * Math.cos(targetLng)
            )
            camera.lookAt(0, yOffset, 0)
        } else {
            introComplete.current = true
        }
    })

    return null
}

// ─── Scene Lighting ──────────────────────────────────────────────────────────

function SceneLighting() {
    return (
        <>
            <ambientLight intensity={0.15} />
            <pointLight position={[5, 3, 5]} intensity={0.8} color="#4488cc" />
            <pointLight position={[-5, -2, -5]} intensity={0.3} color="#ff4444" />
            <pointLight position={[0, 5, 0]} intensity={0.2} color="#ffffff" />
        </>
    )
}

// ─── Main 3D Scene (inside Canvas) ───────────────────────────────────────────

// Mobile Y-offset: shift globe up so Southern Cone isn't hidden by UI panel
const MOBILE_Y_OFFSET = 1.2

function Scene({
    data,
    onHover,
    onSelect,
}: {
    data: CountryStress[]
    onHover: (country: CountryStress | null, worldPos: THREE.Vector3 | null) => void
    onSelect?: (iso2: string) => void
}) {
    const { size } = useThree()
    const globeGroupRef = useRef<THREE.Group>(null!)

    // Responsive: detect portrait / narrow viewport
    const isMobile = size.width < 768 || size.width / size.height < 1
    const yOffset = isMobile ? MOBILE_Y_OFFSET : 0

    // Single rotation for globe + borders + markers — all in sync
    useFrame(({ clock }) => {
        if (globeGroupRef.current) {
            globeGroupRef.current.rotation.y = clock.getElapsedTime() * 0.03
        }
    })

    // Memoize the OrbitControls target to avoid creating a new Vector3 every render
    const orbitTarget = useMemo(() => new THREE.Vector3(0, yOffset, 0), [yOffset])

    return (
        <>
            <CameraController yOffset={yOffset} />
            <SceneLighting />

            <Stars
                radius={100}
                depth={60}
                count={4000}
                factor={4}
                saturation={0}
                fade
                speed={0.5}
            />

            {/* Parent group: shifts everything up on mobile */}
            <group position={[0, yOffset, 0]}>
                {/* Single rotating group: globe + borders + markers */}
                <group ref={globeGroupRef}>
                    <CyberpunkGlobe />
                    <StressMarkers
                        data={data}
                        globeRadius={GLOBE_RADIUS}
                        onHover={onHover}
                        onSelect={onSelect}
                    />
                </group>

                <AtmosphereGlow />
            </group>

            <OrbitControls
                enablePan={false}
                autoRotate
                autoRotateSpeed={0.3}
                minDistance={2.5}
                maxDistance={6}
                enableDamping
                dampingFactor={0.05}
                rotateSpeed={0.5}
                target={orbitTarget}
            />
        </>
    )
}

// ─── Canvas Wrapper (exported) ───────────────────────────────────────────────

export default function GlobeScene({ data, onHover, onSelect }: GlobeSceneProps) {
    const handleHover = (country: CountryStress | null, worldPos: THREE.Vector3 | null) => {
        if (!country || !worldPos) {
            onHover(null, null)
            return
        }
        // We pass a fixed offset position for the tooltip (CSS handles placement)
        onHover(country, { x: 0, y: 0 })
    }

    return (
        <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
            <Canvas
                camera={{ position: [0, 0, 6], fov: 45, near: 0.1, far: 200 }}
                gl={{
                    antialias: true,
                    alpha: false,
                    powerPreference: 'high-performance',
                    toneMapping: THREE.ACESFilmicToneMapping,
                    toneMappingExposure: 1.2,
                }}
                style={{ width: '100%', height: '100%' }}
            >
                <Suspense fallback={null}>
                    <Scene data={data} onHover={handleHover} onSelect={onSelect} />
                </Suspense>
            </Canvas>
        </div>
    )
}
