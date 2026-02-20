/**
 * Apply all SQL migrations to Supabase using the service role key.
 * Uses the Supabase Management API's SQL execution endpoint.
 *
 * Run this ONCE to set up the schema.
 * Usage: pnpm tsx scripts/apply-migrations.ts
 */
import axios from 'axios'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Missing Supabase credentials in .env.local')
}

async function runSQL(label: string, sql: string) {
    console.log(`\n🔧 Applying: ${label}...`)
    const { data, status } = await axios.post(
        `${SUPABASE_URL}/rest/v1/rpc/run_sql`,
        { query: sql },
        {
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
            },
        }
    )
    console.log(`  ✅ Done (HTTP ${status})`)
    return data
}

// ─── Migration 1: countries ───────────────────────────────────────────────────
const M1_COUNTRIES = `
CREATE TABLE IF NOT EXISTS countries (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  iso2             CHAR(2) UNIQUE NOT NULL,
  iso3             CHAR(3) UNIQUE NOT NULL,
  imf_code         TEXT,
  currency         CHAR(3) NOT NULL,
  fred_series_10y  TEXT
);
COMMENT ON TABLE  countries IS 'MVP LatAm countries. 6 entries, static.';
COMMENT ON COLUMN countries.fred_series_10y IS 'FRED series for sovereign 10Y yield. NULL = use IMF IFS SDMX fallback.';
`

// ─── Migration 2: metrics_daily ───────────────────────────────────────────────
const M2_METRICS_DAILY = `
CREATE TABLE IF NOT EXISTS metrics_daily (
  id              SERIAL PRIMARY KEY,
  country_id      INT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  date            DATE NOT NULL,

  -- RAW VALUES
  fx_close          NUMERIC,
  inflation_yoy     NUMERIC,
  sovereign_yield   NUMERIC,
  us_10y            NUMERIC,
  reserves_level    NUMERIC,
  arg_blue_gap      NUMERIC,

  -- DERIVED METRICS
  fx_vol            NUMERIC,
  inflation         NUMERIC,
  risk_spread       NUMERIC,
  crypto_ratio      NUMERIC,
  reserves_change   NUMERIC,

  -- OUTPUT (NULL during backfill)
  stress_score      NUMERIC,

  -- METADATA
  data_flags        JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT metrics_daily_unique UNIQUE (country_id, date)
);
CREATE INDEX IF NOT EXISTS idx_metrics_country_date ON metrics_daily (country_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_date          ON metrics_daily (date DESC);

COMMENT ON COLUMN metrics_daily.arg_blue_gap   IS 'Argentina only. Parallel/official FX gap %. NULL for all other countries.';
COMMENT ON COLUMN metrics_daily.crypto_ratio   IS 'Global stablecoin dominance proxy. Same value for all countries on a given date.';
COMMENT ON COLUMN metrics_daily.stress_score   IS 'Final 0-100 stress score. NULL during backfill. Populated by cron only.';
COMMENT ON COLUMN metrics_daily.data_flags     IS 'JSON flags documenting forward-fills, API fallbacks, etc.';
`

// ─── Migration 3: normalization_params ────────────────────────────────────────
const M3_NORMALIZATION = `
CREATE TABLE IF NOT EXISTS normalization_params (
  id                 SERIAL PRIMARY KEY,
  country_id         INT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  metric_name        TEXT NOT NULL,
  min_val            NUMERIC NOT NULL,
  max_val            NUMERIC NOT NULL,
  percentile_method  TEXT NOT NULL DEFAULT 'p5_p95_clamped',
  window_start       DATE NOT NULL,
  window_end         DATE NOT NULL,
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT normalization_params_unique UNIQUE (country_id, metric_name)
);
COMMENT ON TABLE  normalization_params IS 'p5/p95 normalization bounds. Updated quarterly.';
COMMENT ON COLUMN normalization_params.percentile_method IS 'p5_p95_clamped: score = clamp((v-min)/(max-min), 0, 1) * 100';
`

// ─── Migration 4: pipeline_log ────────────────────────────────────────────────
const M4_PIPELINE_LOG = `
CREATE TABLE IF NOT EXISTS pipeline_log (
  id         SERIAL PRIMARY KEY,
  run_date   DATE NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  detail     JSONB,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_log_run_date ON pipeline_log (run_date DESC);
COMMENT ON TABLE pipeline_log IS 'Audit log for each daily cron run.';
`

async function main() {
    console.log('🚀 Applying schema migrations to Supabase...')
    console.log(`   Project: ${SUPABASE_URL}\n`)

    await runSQL('001 — countries', M1_COUNTRIES)
    await runSQL('002 — metrics_daily', M2_METRICS_DAILY)
    await runSQL('003 — normalization_params', M3_NORMALIZATION)
    await runSQL('004 — pipeline_log', M4_PIPELINE_LOG)

    console.log('\n🎉 All migrations applied successfully.')
    console.log('   Next step: pnpm db:seed')
}

main()
