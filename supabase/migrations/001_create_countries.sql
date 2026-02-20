-- Migration: 001_create_countries.sql
-- Table to store the 6 MVP countries

CREATE TABLE IF NOT EXISTS countries (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  iso2             CHAR(2) UNIQUE NOT NULL,
  iso3             CHAR(3) UNIQUE NOT NULL,
  imf_code         TEXT,
  currency         CHAR(3) NOT NULL,
  fred_series_10y  TEXT  -- FRED series ID for 10Y yield, NULL if using IMF IFS fallback
);

COMMENT ON TABLE  countries IS 'MVP LatAm countries. 6 entries, static.';
COMMENT ON COLUMN countries.fred_series_10y IS 'FRED series for sovereign 10Y yield. NULL = use IMF IFS SDMX fallback.';
