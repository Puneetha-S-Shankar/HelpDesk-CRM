-- Migration 001 — Ravi Nov 12 schema correction baseline
--
-- For empty databases, apply the full rebuild instead:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
--
-- This file records the version for environments that track applied migrations.
-- Do not re-run corrective DDL here; root schema.sql already contains the
-- complete post-correction definition (ticket numbering, TZ business minutes,
-- create_ticket, hold/SLA, routing, RESTRICT audit FKs, hot indexes, exhausted).

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  description text
);

INSERT INTO schema_migrations (version, description)
VALUES (
  '001',
  'Ravi Nov 12 correction: numbering, TZ SLA, create_ticket, holds, routing, RESTRICT audit, indexes'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
