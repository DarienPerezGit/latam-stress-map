'use client'

import React, { useMemo, useState, useEffect } from 'react'
import * as THREE from 'three'
import { latLngToSphere } from './countryData'

interface LatAmBordersProps {
    globeRadius: number
}

// GeoJSON types (minimal)
interface GeoFeature {
    type: string
    properties: { iso2: string }
    geometry: {
        type: 'Polygon' | 'MultiPolygon'
        coordinates: number[][][] | number[][][][]
    }
}

interface GeoCollection {
    type: string
    features: GeoFeature[]
}

/**
 * Interpolate mid-points between two lat/lng positions along the sphere surface.
 * This creates geodesic curves instead of straight-line "chords" that cut through the sphere.
 */
function subdivideLine(
    p1: [number, number, number],
    p2: [number, number, number],
    subdivisions: number
): [number, number, number][] {
    const points: [number, number, number][] = [p1]

    for (let i = 1; i <= subdivisions; i++) {
        const t = i / (subdivisions + 1)
        // Linear interpolation in cartesian space, then project back onto sphere
        const x = p1[0] + (p2[0] - p1[0]) * t
        const y = p1[1] + (p2[1] - p1[1]) * t
        const z = p1[2] + (p2[2] - p1[2]) * t

        // Normalize to sphere radius to maintain curvature
        const len = Math.sqrt(x * x + y * y + z * z)
        const radius = Math.sqrt(p1[0] ** 2 + p1[1] ** 2 + p1[2] ** 2)
        const scale = radius / len

        points.push([x * scale, y * scale, z * scale])
    }

    points.push(p2)
    return points
}

/**
 * Convert a GeoJSON polygon ring (array of [lng, lat]) to 3D positions on the sphere.
 * Returns pairs of points for LineSegments (p1,p2, p2,p3, p3,p4, ...).
 */
function ringToLineSegments(
    ring: number[][],
    radius: number,
    subdivisions: number
): number[] {
    const vertices: number[] = []

    for (let i = 0; i < ring.length - 1; i++) {
        const [lng1, lat1] = ring[i]
        const [lng2, lat2] = ring[i + 1]

        const p1 = latLngToSphere(lat1, lng1, radius)
        const p2 = latLngToSphere(lat2, lng2, radius)

        // Calculate distance between points to decide subdivision level
        const dx = p2[0] - p1[0]
        const dy = p2[1] - p1[1]
        const dz = p2[2] - p1[2]
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

        // Only subdivide long segments (> 0.1 units on sphere)
        const subs = dist > 0.1 ? subdivisions : Math.max(1, Math.floor(subdivisions / 2))
        const interpolated = subdivideLine(p1, p2, subs)

        // Add as line segment pairs: [A,B], [B,C], [C,D], ...
        for (let j = 0; j < interpolated.length - 1; j++) {
            vertices.push(...interpolated[j], ...interpolated[j + 1])
        }
    }

    return vertices
}

export default function LatAmBorders({ globeRadius }: LatAmBordersProps) {
    const [geoData, setGeoData] = useState<GeoCollection | null>(null)

    // Load GeoJSON on mount
    useEffect(() => {
        fetch('/geo/latam-borders.json')
            .then(res => res.json())
            .then(data => setGeoData(data))
            .catch(err => console.warn('Failed to load border data:', err))
    }, [])

    // Convert GeoJSON → Three.js BufferGeometry (memoized)
    const geometry = useMemo(() => {
        if (!geoData) return null

        const BORDER_OFFSET = 0.003 // Slightly above globe surface to prevent z-fighting
        const radius = globeRadius + BORDER_OFFSET
        const SUBDIVISIONS = 5

        const allVertices: number[] = []

        for (const feature of geoData.features) {
            const { geometry: geo } = feature

            let polygons: number[][][][] = []

            if (geo.type === 'Polygon') {
                polygons = [geo.coordinates as number[][][]]
            } else if (geo.type === 'MultiPolygon') {
                polygons = geo.coordinates as number[][][][]
            }

            for (const polygon of polygons) {
                for (const ring of polygon) {
                    const segments = ringToLineSegments(ring, radius, SUBDIVISIONS)
                    allVertices.push(...segments)
                }
            }
        }

        const bufferGeo = new THREE.BufferGeometry()
        bufferGeo.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(allVertices, 3)
        )

        return bufferGeo
    }, [geoData, globeRadius])

    if (!geometry) return null

    return (
        <lineSegments geometry={geometry}>
            <lineBasicMaterial
                color="#1a3a5c"
                transparent
                opacity={0.3}
                depthTest={true}
                depthWrite={false}
            />
        </lineSegments>
    )
}
