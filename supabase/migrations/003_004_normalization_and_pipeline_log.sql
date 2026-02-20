-- Migration: 003_create_normalization_params.sql
-- Stores p5/p95 bounds per country × metric.
-- Updated quarterly (not daily). Locked at backfill time.

CREATE TABLE IF NOT EXISTS normalization_params (
  id                 SERIAL PRIMARY KEY,
  country_id         INT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  metric_name        TEXT NOT NULL,       -- 'fx_vol' | 'inflation' | 'risk_spread' | 'crypto_ratio' | 'reserves_change'
  min_val            NUMERIC NOT NULL,    -- p5 of historical distribution
  max_val            NUMERIC NOT NULL,    -- p95 of historical distribution
  percentile_method  TEXT NOT NULL DEFAULT 'p5_p95_clamped',
  window_start       DATE NOT NULL,       -- Start of historical window used
  window_end         DATE NOT NULL,       -- End of historical window used
  updated_at         TIMESTAMPTZ DEFAULT NOW(),

  -- One row per (country, metric). Upserted quarterly.
  CONSTRAINT normalization_params_unique UNIQUE (country_id, metric_name)
);

COMMENT ON TABLE  normalization_params IS 'p5/p95 normalization bounds. Crypto uses 1yr window; others use full history. Updated quarterly.';
COMMENT ON COLUMN normalization_params.percentile_method IS 'Currently: p5_p95_clamped. Score = clamp((v - min_val)/(max_val - min_val), 0, 1) * 100.';
COMMENT ON COLUMN normalization_params.window_start IS 'For crypto_ratio: today-365. For others: 2019-01-01.';


-- Migration: 004_create_pipeline_log.sql
-- Audit log for each daily pipeline run.

CREATE TABLE IF NOT EXISTS pipeline_log (
  id         SERIAL PRIMARY KEY,
  run_date   DATE NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  detail     JSONB,                         -- Per-country, per-metric success/fail detail
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_log_run_date
  ON pipeline_log (run_date DESC);

COMMENT ON TABLE pipeline_log IS 'Audit log for each daily cron run. Used for monitoring and debugging.';
