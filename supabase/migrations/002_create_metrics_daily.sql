-- Migration: 002_create_metrics_daily.sql
-- Core time-series table: one row per (country, date)

CREATE TABLE IF NOT EXISTS metrics_daily (
  id              SERIAL PRIMARY KEY,

  -- Identity
  country_id      INT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  date            DATE NOT NULL,

  -- RAW VALUES (source of truth — allows formula recomputation without re-hitting APIs)
  fx_close          NUMERIC,          -- USD/{currency} daily close price
  inflation_yoy     NUMERIC,          -- Latest YoY CPI % (monthly, forward-filled)
  sovereign_yield   NUMERIC,          -- Country 10Y gov bond yield % (monthly, forward-filled)
  us_10y            NUMERIC,          -- US 10Y Treasury yield % (daily, forward-filled on weekends)
  reserves_level    NUMERIC,          -- Total international reserves in USD (monthly, forward-filled)
  arg_blue_gap      NUMERIC,          -- ARG only: (blue - official) / official * 100. NULL for non-ARG rows.

  -- DERIVED METRICS (stored for query performance)
  fx_vol            NUMERIC,          -- 30-day rolling std dev of log FX returns
  inflation         NUMERIC,          -- Acceleration = latest_yoy - 6mo_rolling_avg_yoy
  risk_spread       NUMERIC,          -- sovereign_yield - us_10y (%)
  crypto_ratio      NUMERIC,          -- (USDT + USDC mcap) / BTC mcap — global proxy
  reserves_change   NUMERIC,          -- 90-day % change in reserves_level

  -- OUTPUT (computed only after normalization_params exist — stays NULL during backfill)
  stress_score      NUMERIC,          -- Final weighted score 0–100. NULL until cron pipeline runs.

  -- Metadata
  data_flags        JSONB DEFAULT '{}',  -- e.g. {"inflation": "forward_filled", "arg_blue_gap": "api_unavailable"}
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT metrics_daily_unique UNIQUE (country_id, date)
);

-- Primary query pattern: latest N days for a country
CREATE INDEX IF NOT EXISTS idx_metrics_country_date
  ON metrics_daily (country_id, date DESC);

-- For cross-country date queries (map view)
CREATE INDEX IF NOT EXISTS idx_metrics_date
  ON metrics_daily (date DESC);

COMMENT ON TABLE  metrics_daily IS 'Core time-series table. One row per (country, date). Backfill keeps stress_score=NULL.';
COMMENT ON COLUMN metrics_daily.arg_blue_gap   IS 'Argentina only. Parallel/official FX gap %. NULL for all other countries.';
COMMENT ON COLUMN metrics_daily.crypto_ratio   IS 'Global stablecoin dominance proxy. Same value for all countries on a given date.';
COMMENT ON COLUMN metrics_daily.stress_score   IS 'Final 0-100 stress score. NULL during backfill. Populated by /api/cron/update only.';
COMMENT ON COLUMN metrics_daily.data_flags     IS 'JSON flags documenting any non-standard data handling (forward-fills, API fallbacks, etc.)';
