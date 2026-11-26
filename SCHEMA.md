# PropDesk Helpdesk CRM: Database Schema (v7, final closeout)

Full SQL: [schema.sql](schema.sql) · Tests: [schema_tests.sql](schema_tests.sql) · Migrations: [migrations/](migrations/) · Design: [docs/LLD.md](docs/LLD.md) · Load: [docs/LOAD_TEST.md](docs/LOAD_TEST.md)

PostgreSQL 16+. Shared database with **row-level security** (`SET LOCAL app.enterprise_id`) plus composite foreign keys on `enterprise_id`. Roles: `propdesk_app` / `propdesk_readonly` (UPDATE/DELETE revoked on append-only tables). Dedicated database remains a later paid tier (LLD §1.1).

**Final closeout includes:** Ravi Nov 12 §1–§7 SQL priorities, §6 engines wired (severity skip, workload_cap, nobody_free, fan-out, licence, category-tree chains), breach writers, busy restore, AI apply/triage, monthly partitions, DPDPA `anonymise_tenant`.

## Platform posture

| Concern | Mechanism |
|---|---|
| Cross-tenant *references* | Composite FKs `(enterprise_id, …)` |
| Cross-tenant *access* | RLS + `assert_enterprise()`; DEFINER functions pin `search_path` |
| Session | API sets `SET LOCAL app.enterprise_id` once per transaction |
| Append-only | Triggers + REVOKE UPDATE/DELETE on `ticket_events` / `audit_log` for `propdesk_app` |

## 1. Platform and settings

| Table | Notes |
|---|---|
| `enterprises` | Licensee company |
| `licenses` | **History rows**; one `is_current`; `assert_licence_active` on create |
| `enterprise_settings` | Prefix, auto-close, **reopen_window_days**, at-risk %, AI mode/threshold/raise-cap/timeout, outbox max attempts |
| `enterprise_counters` | Ticket numbers (`next_ticket_number` pads ≥5 digits; race-safe upsert) |

## 2. Business hours

Calendars carry **timezone** (DST-aware). Multiple windows per weekday supported (split shifts). Empty hours → raise; 366-day cap.

## 3–5. Portfolio, people, rules

Unchanged roles. Skills match by **category_id only**. Escalation chains: published + in-use children immutable. Severity rules drive skip / window factor / force 24×7. Levels expose `workload_cap`, `nobody_free`, `mode`.

**SLA source of truth:** `sla_policies` (unique per category); category mins are optional overrides via `COALESCE(cat, pol)`.

**Sentiment source of truth:** writable on `ticket_comments` and `ai_predictions`; tenant/ticket sentiment columns are denormalised cache only.

## 6. Tickets

| Concern | Behaviour |
|---|---|
| Escalation | Fields `escalation_level` + `escalation_state` (`none`/`waiting`/`acked`/`exhausted`); work status unchanged |
| Create | `create_ticket` → number, `chain_id` (category-tree walk), `ai_enrich` outbox, level 0 + policy |
| Holds | Cancel/re-arm SLA; business-minute pause; restore `status_before_hold` |
| Breaches | `respond_breached_at` / `resolve_breached_at` written by `act_and_consume_timer` |
| Integrity | Trigger: unit.property = ticket.property; lease.unit = ticket.unit |
| Channel / severity | CHECKed lists |

`ticket_events`, `ticket_timers`, `outbox_events`, `audit_log` are **monthly RANGE partitioned** (plus DEFAULT).

## 7. AI, outbox, audit

| Function | Notes |
|---|---|
| `apply_ai_prediction` | Auto threshold / human confirm; raise cap; non-leaf → triage; then policy + route |
| `ai_enrich_timeout` | Marks triage + `timed_out` |
| Outbox | dedupe_key, back-off, `locked_until`, `dead` |
| `anonymise_tenant` | Scrubs PII; appends audit; keeps history |

## 8. Engine (high level)

- Timers: `claim_due_timer` → `act_and_consume_timer` (breach / busy restore / ack timeout / auto-close) in one txn
- Routing: advisory + SKIP LOCKED; workload_cap; nobody_free → unassign / escalate / notify_manager
- Escalate: severity skip; exhausted at top; ack anti-loop (2m); level fan-out notify
- `change_ticket_classification`: recompute from now, keep pause totals

## 9. Verification

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql -f schema_tests.sql
```

Tests cover numbering, TZ/DST, holds, dual-assign, exhausted, severity skip, breaches, busy restore, AI triage/raise-cap/non-leaf, licence block, anonymise, partitions, cross-tenant create/escalate, handoff freeze.
