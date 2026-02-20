import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load .env.local for script execution context (not needed in Next.js runtime)
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
    )
}

/**
 * Server-side Supabase client using service role key.
 * Use ONLY in scripts and API routes — never expose to browser.
 */
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
})
