-- Migration: 005_add_stablecoin_premium.sql
-- Adds stablecoin premium column to metrics_daily.
-- This captures the USDT P2P spread vs official FX rate per country.
-- Initially only populated for Argentina (AR). NULL for all other countries.

-- ── 1. New column on metrics_daily ──────────────────────────────────────────

ALTER TABLE metrics_daily
  ADD COLUMN IF NOT EXISTS stablecoin_premium NUMERIC;

COMMENT ON COLUMN metrics_daily.stablecoin_premium
  IS 'Stablecoin P2P premium %. Formula: (median_usdt_local - fx_close) / fx_close * 100. AR only for now. NULL for other countries.';

-- ── 2. Update metric_name comment on normalization_params ───────────────────
-- (Documentation only — the TEXT column accepts any string already)

COMMENT ON COLUMN normalization_params.metric_name
  IS 'fx_vol | inflation | risk_spread | crypto_ratio | reserves_change | stablecoin_premium';
