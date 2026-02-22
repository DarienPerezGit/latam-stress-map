/**
 * Latin American country geo-data for 3D globe positioning.
 * lat/lng → converted to 3D sphere coordinates at render time.
 * area: relative size factor for marker scaling.
 */

export interface CountryGeo {
    iso2: string
    name: string
    lat: number
    lng: number
    area: number // 0.5–2.0 scale factor
}

export const LATAM_COUNTRIES: CountryGeo[] = [
    { iso2: 'AR', name: 'Argentina', lat: -34.60, lng: -58.38, area: 1.8 },
    { iso2: 'BO', name: 'Bolivia', lat: -16.50, lng: -68.15, area: 0.9 },
    { iso2: 'BR', name: 'Brazil', lat: -15.78, lng: -47.93, area: 2.0 },
    { iso2: 'CL', name: 'Chile', lat: -33.45, lng: -70.67, area: 1.0 },
    { iso2: 'CO', name: 'Colombia', lat: 4.71, lng: -74.07, area: 1.2 },
    { iso2: 'CR', name: 'Costa Rica', lat: 9.93, lng: -84.09, area: 0.5 },
    { iso2: 'DO', name: 'Dom. Republic', lat: 18.47, lng: -69.90, area: 0.5 },
    { iso2: 'EC', name: 'Ecuador', lat: -0.18, lng: -78.47, area: 0.7 },
    { iso2: 'GT', name: 'Guatemala', lat: 14.63, lng: -90.51, area: 0.6 },
    { iso2: 'HN', name: 'Honduras', lat: 14.07, lng: -87.19, area: 0.5 },
    { iso2: 'MX', name: 'Mexico', lat: 19.43, lng: -99.13, area: 1.6 },
    { iso2: 'NI', name: 'Nicaragua', lat: 12.11, lng: -86.24, area: 0.5 },
    { iso2: 'PA', name: 'Panama', lat: 8.98, lng: -79.52, area: 0.5 },
    { iso2: 'PE', name: 'Peru', lat: -12.05, lng: -77.04, area: 1.3 },
    { iso2: 'PY', name: 'Paraguay', lat: -25.26, lng: -57.58, area: 0.7 },
    { iso2: 'SV', name: 'El Salvador', lat: 13.69, lng: -89.22, area: 0.4 },
    { iso2: 'UY', name: 'Uruguay', lat: -34.88, lng: -56.16, area: 0.6 },
    { iso2: 'VE', name: 'Venezuela', lat: 10.48, lng: -66.87, area: 1.1 },
]

/**
 * Convert lat/lng to 3D position on a sphere of given radius.
 */
export function latLngToSphere(lat: number, lng: number, radius: number): [number, number, number] {
    const phi = (90 - lat) * (Math.PI / 180)
    const theta = (lng + 180) * (Math.PI / 180)

    const x = -(radius * Math.sin(phi) * Math.cos(theta))
    const y = radius * Math.cos(phi)
    const z = radius * Math.sin(phi) * Math.sin(theta)

    return [x, y, z]
}

/**
 * Get stress color from score.
 */
export function getStressColor(score: number): string {
    if (score < 30) return '#10b981'
    if (score < 60) return '#f59e0b'
    if (score < 80) return '#f97316'
    return '#ef4444'
}

/**
 * Get stress level label.
 */
export function getStressLevel(score: number): string {
    if (score < 30) return 'LOW'
    if (score < 60) return 'MODERATE'
    if (score < 80) return 'HIGH'
    return 'CRITICAL'
}
