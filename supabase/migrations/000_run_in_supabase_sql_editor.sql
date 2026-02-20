-- ============================================================
-- LatAm Macro Stress Map — Full Schema Migration
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New query
-- Project: husrjplmqrfqjbfihxbm (latam-stress-map)
-- ============================================================

-- ── Table 1: countries ────────────────────────────────────────
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

-- ── Table 2: metrics_daily ────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics_daily (
  id              SERIAL PRIMARY KEY,
  country_id      INT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  date            DATE NOT NULL,

  -- RAW VALUES (source of truth — allows formula recomputation without re-fetching APIs)
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

  -- OUTPUT (NULL during backfill — only computed by cron pipeline)
  stress_score      NUMERIC,

  -- METADATA
  data_flags        JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT metrics_daily_unique UNIQUE (country_id, date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_country_date ON metrics_daily (country_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_date          ON metrics_daily (date DESC);

COMMENT ON COLUMN metrics_daily.arg_blue_gap  IS 'Argentina only. (blue - official) / official * 100. NULL for all other countries.';
COMMENT ON COLUMN metrics_daily.crypto_ratio  IS 'Global stablecoin dominance proxy: (USDT+USDC mcap) / BTC mcap. Same value all countries per date.';
COMMENT ON COLUMN metrics_daily.stress_score  IS 'Final 0-100 score. NULL during backfill. Set by /api/cron/update only.';
COMMENT ON COLUMN metrics_daily.data_flags    IS 'JSON audit flags: forward-fills, API fallbacks, etc.';

-- ── Table 3: normalization_params ─────────────────────────────
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

COMMENT ON TABLE  normalization_params IS 'p5/p95 normalization bounds per country×metric. Updated quarterly, never daily.';
COMMENT ON COLUMN normalization_params.percentile_method IS 'p5_p95_clamped: score = clamp((v - min_val)/(max_val - min_val), 0, 1) * 100';
COMMENT ON COLUMN normalization_params.window_start IS 'crypto_ratio: today-365. All others: 2019-01-01.';

-- ── Table 4: pipeline_log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_log (
  id         SERIAL PRIMARY KEY,
  run_date   DATE NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  detail     JSONB,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_log_run_date ON pipeline_log (run_date DESC);
COMMENT ON TABLE pipeline_log IS 'Audit log for each daily cron pipeline run.';

-- ── Done ──────────────────────────────────────────────────────
-- Expected result: 4 tables created, 3 indexes created
-- Verify: SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
