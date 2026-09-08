-- ==================================================================
-- FUELWISE — PostgreSQL bootstrap (runs once on first container boot)
--   * Creates the dedicated TimescaleDB database used for time-series
--     queue / wait-time telemetry (Phase 2+).
--   * The relational core database (fuelwise_db) already exists because
--     it is set via the POSTGRES_DB environment variable.
-- ==================================================================

CREATE DATABASE fuelwise_tsdb;

\connect fuelwise_tsdb

-- Enable the TimescaleDB extension for hypertable support.
CREATE EXTENSION IF NOT EXISTS timescaledb;
