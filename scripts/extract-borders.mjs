/**
 * Extract 6 MVP LatAm country borders from world-atlas TopoJSON → GeoJSON.
 * Output: public/geo/latam-borders.json
 *
 * Usage: node scripts/extract-borders.mjs
 */
import { readFileSync, writeFileSync } from 'fs'
import * as topojson from 'topojson-client'

// ISO 3166-1 numeric codes for our 6 MVP countries
const MVP_CODES = {
    '032': 'AR',  // Argentina
    '076': 'BR',  // Brazil
    '152': 'CL',  // Chile
    '170': 'CO',  // Colombia
    '484': 'MX',  // Mexico
    '604': 'PE',  // Peru
}

const topoData = JSON.parse(readFileSync('tmp_ne_110m.json', 'utf-8'))

// Convert TopoJSON → full GeoJSON FeatureCollection
const allCountries = topojson.feature(topoData, topoData.objects.countries)

// Filter to only MVP countries
const mvpFeatures = allCountries.features.filter(f => {
    const id = String(f.id).padStart(3, '0')
    return MVP_CODES[id] !== undefined
})

// Tag each feature with its ISO2 code
mvpFeatures.forEach(f => {
    const id = String(f.id).padStart(3, '0')
    f.properties = { iso2: MVP_CODES[id] }
})

const output = {
    type: 'FeatureCollection',
    features: mvpFeatures,
}

const json = JSON.stringify(output)
writeFileSync('public/geo/latam-borders.json', json)

console.log(`✅ Extracted ${mvpFeatures.length} countries`)
console.log(`   ISO codes: ${mvpFeatures.map(f => f.properties.iso2).join(', ')}`)
console.log(`   File size: ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB`)
