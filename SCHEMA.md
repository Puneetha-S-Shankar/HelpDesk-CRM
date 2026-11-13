# PropDesk Helpdesk CRM: Database Schema (v5, Ravi revision)

Full SQL: [schema.sql](schema.sql) · Tests: [schema_tests.sql](schema_tests.sql) · Design: [docs/LLD.md](docs/LLD.md) · Load: [docs/LOAD_TEST.md](docs/LOAD_TEST.md)

PostgreSQL 16+. Shared database with **row-level security** (`SET LOCAL app.enterprise_id`) plus composite foreign keys on `enterprise_id`. Dedicated database remains a later paid tier (see LLD §1.1 vs IMS).

**Keep:** composite FKs, `ticket_assignments` as Ownership history, immutable published chains, SKIP LOCKED timers + outbox, AI corrections on the prediction row, Heating sample story as acceptance.

## Platform posture

| Concern | Mechanism |
|---|---|
| Cross-tenant *references* | Composite FKs `(enterprise_id, …)` |
| Cross-tenant *access* | RLS + `assert_enterprise()`; DEFINER functions pin `search_path` |
| Session | API sets `SET LOCAL app.enterprise_id` once per transaction |

## 1. Platform and settings

| Table | Notes |
|---|---|
| `enterprises` | Licensee company |
| `licenses` | Plan, seats, price, expiry, grace |
| `enterprise_settings` | Prefix, auto-close, **reopen_days**, at-risk %, **ai_routing_mode**, confidence threshold, priority raise cap, AI timeout, outbox max attempts |
| `enterprise_counters` | Ticket numbers |

## 2. Business hours

| Table | Notes |
|---|---|
| `business_calendars` | Named calendars + **timezone** (DST-aware SLA math) |
| `business_hours` | Weekday windows |
| `calendar_holidays` | Closed days |

## 3. Portfolio

`regions`, `properties`, `units`, `assets`, `tenants`, `leases` — unchanged roles; properties keep timezone + calendar link.

## 4. People and access

| Table | Notes |
|---|---|
| `roles` / `role_permissions` | Includes Type 3 keys: `accept`, `decline`, `busy`, `respond`, `resolve` |
| `users` | Availability, maintained `open_ticket_count`, **busy_until** |
| `user_absences` | Leave / busy windows |
| `user_properties` | Property coverage |
| `user_region_scopes` | Regional Admin region limits |
| `user_skills` | Match by **category_id only** |

## 5. Rules

`categories`, `sla_policies`, `priority_rules`, `escalation_chains`, `escalation_levels`, `escalation_level_roles`, `escalation_severity_rules`, `routing_rules`, `hold_reasons` (tenant SLA pause + optional **pauses_level_timers**).

Published chains in use cannot be edited in place.

## 6. Tickets

| Table | Notes |
|---|---|
| `tickets` | Work **status** has no `Escalated`; use `escalation_level` + `escalation_state`; breach timestamps; `needs_triage`; `declined_user_ids` |
| `ticket_levels` | Per-level clocks |
| `ticket_assignments` | Ownership handoff history (authoritative for who held the ticket) |
| `ticket_holds` | Hold windows |
| `ticket_timers` | `consumed_at` + **`cancelled_at`**; claim/act/consume in one txn; partial index on due open timers |
| `ticket_comments` | Tenant / reply / internal |
| `ticket_events` | Operational timeline — **append-only** |
| `notifications` | User inbox; **created by** outbox notify handlers (outbox is the queue) |

## 7. AI, outbox, audit

| Table | Notes |
|---|---|
| `ai_predictions` | **routing_mode**, model, **prompt_version**, needs_triage, corrections |
| `outbox_events` | **dedupe_key**, back-off (`next_attempt_at`), status includes **dead** |
| `audit_log` | Config changes — **append-only** |

## 8. Reports and migration

`report_runs`, `import_jobs`, `import_rows`, view `ticket_facts`.  
Open imports arm SLA from import time; closed historical imports skip clocks.

## 9. Engine functions (high level)

- Tenancy: `current_enterprise_id`, `assert_enterprise`
- Timers: `arm_timer`, `clear_open_timers` (cancels), `claim_due_timer`, `consume_timer`
- Lifecycle: `enter_level`, `assign_level`, `pick_and_assign` (advisory lock + `FOR UPDATE`), `respond_to_ticket`, `decline_assignment`, `mark_assignee_busy(duration)`, holds, `escalate_ticket` / `acknowledge_escalation`, resolve / reopen (window or follow-up) / close
- Policy/time: `apply_ticket_policy`, `resolve_sla_policy`, `resolve_chain`, business-minute helpers

Worker contract is documented above `ticket_timers` in [schema.sql](schema.sql) and in LLD §6 (5s poll, &lt;30s lag).

## 10. Verification

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql -f schema_tests.sql
```

Tests cover: sample story (Dana→Marcus→Unassigned→escalate without changing work status→ack→resolve→close), cross-tenant assert, double timer consume, serialized dual assign, append-only events.
