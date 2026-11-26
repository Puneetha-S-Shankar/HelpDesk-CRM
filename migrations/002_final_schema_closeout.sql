-- Migration 002 — Final schema closeout (Ravi full checklist)
--
-- For empty databases, apply the full rebuild instead:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
--
-- This version marker records that breach writers, busy restore, AI apply,
-- §6 engines, roles/GRANTs, partitions, and DPDPA anonymise are in schema.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  description text
);

INSERT INTO schema_migrations (version, description)
VALUES (
  '002',
  'Final closeout: breach/busy/AI/§6 engines, GRANTs, partitions, anonymise_tenant'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
