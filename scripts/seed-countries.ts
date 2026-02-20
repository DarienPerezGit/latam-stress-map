/**
 * Seed the `countries` table with the 6 MVP countries.
 * Run once. Idempotent (upsert on iso2 conflict).
 *
 * Usage: pnpm tsx scripts/seed-countries.ts
 */
import { supabase } from '../lib/supabase'

const COUNTRIES = [
    {
        name: 'Argentina',
        iso2: 'AR',
        iso3: 'ARG',
        imf_code: 'AR',
        currency: 'ARS',
        fred_series_10y: null, // Uses IMF IFS fallback
    },
    {
        name: 'Brazil',
        iso2: 'BR',
        iso3: 'BRA',
        imf_code: 'BR',
        currency: 'BRL',
        fred_series_10y: 'INTGSBRZM193N',
    },
    {
        name: 'Chile',
        iso2: 'CL',
        iso3: 'CHL',
        imf_code: 'CL',
        currency: 'CLP',
        fred_series_10y: null, // Uses IMF IFS fallback
    },
    {
        name: 'Colombia',
        iso2: 'CO',
        iso3: 'COL',
        imf_code: 'CO',
        currency: 'COP',
        fred_series_10y: null, // Uses IMF IFS fallback
    },
    {
        name: 'Peru',
        iso2: 'PE',
        iso3: 'PER',
        imf_code: 'PE',
        currency: 'PEN',
        fred_series_10y: null, // Uses IMF IFS fallback
    },
    {
        name: 'Mexico',
        iso2: 'MX',
        iso3: 'MEX',
        imf_code: 'MX',
        currency: 'MXN',
        fred_series_10y: 'INTGSB01M193N',
    },
]

async function main() {
    console.log('🌍 Seeding countries...')

    const { data, error } = await supabase
        .from('countries')
        .upsert(COUNTRIES, { onConflict: 'iso2' })
        .select()

    if (error) {
        console.error('❌ Error seeding countries:', error.message)
        process.exit(1)
    }

    console.log(`✅ Seeded ${data?.length} countries:`)
    data?.forEach((c) => console.log(`  - ${c.name} (${c.iso2}) [id: ${c.id}]`))
}

main()
