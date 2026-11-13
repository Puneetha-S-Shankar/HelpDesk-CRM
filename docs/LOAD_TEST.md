# PropDesk load-test plan

**Goal:** Prove the shared-schema + RLS design and ticket engine hold at **50 enterprises × 500 tickets/day ≈ 25,000 tickets/day**, before API build starts.  
**Companions:** [LLD.md](LLD.md) §1.3 / §6.3, [schema.sql](../schema.sql), [schema_tests.sql](../schema_tests.sql).

---

## 1. Success criteria

| Criterion | Pass bar |
|---|---|
| Sustained create rate | ≥ 25,000 creates / 24h equivalent (or 30-minute burst at proportional rate ≈ 17.4 creates/s fleet-wide) |
| Create p95 (ex-AI) | &lt; 500 ms |
| `pick_and_assign` p95 | &lt; 300 ms |
| Timer/outbox lag | &lt; 30 s (poll 5 s) |
| No double escalate | Zero duplicate escalations from the same `timer_id` |
| Tenant isolation | Zero cross-tenant reads/writes under concurrent sessions |
| Skill-pool races | No two open tickets share the same primary when two free techs exist in the pool |
| Error budget | &lt; 0.1% 5xx / engine exceptions on happy path |

---

## 2. Topology under test

- PostgreSQL 16 (same major as prod target), shared DB, RLS enabled, `FORCE ROW LEVEL SECURITY`.
- App/API stubs or `psql`/k6 scripts that each connection runs `SET LOCAL app.enterprise_id`.
- **2+** timer worker replicas + **2+** outbox workers (SKIP LOCKED).
- Seed: 50 enterprises, each with ≥ 1 Heating leaf category, 3–5 Type 3 users with skills, published escalation chain, calendar + priority rules.

---

## 3. Scenarios

### 3.1 Steady create + route (primary)

For each enterprise in parallel:

1. Create ticket (notes only; enqueue `ai_enrich` but **stub AI** as instant auto-route above threshold).
2. `enter_level(0)` + `pick_and_assign`.
3. 70% `respond_to_ticket` → later `resolve_ticket` → `close_ticket`.
4. 20% decline or busy (with duration) once, then accept on next assignee.
5. 10% escalate on ack timeout (worker-driven) → acknowledge → resolve.

Mix yields Ownership history, Unassigned paths, and escalation without treating Escalated as work status.

### 3.2 Timer storm

Arm many `escalation_ack` / `tenant_respond` timers in the past; workers drain them. Assert:

- Each timer consumed at most once.
- Lag histogram p99 &lt; 30 s.
- Cancelled timers never acted on.

### 3.3 Isolation adversarial

Sessions for enterprise A attempt `next_ticket_number(B)`, `pick_and_assign(B, …)`, and plain `SELECT` on B’s tickets without setting B’s session var. All must fail (assert / RLS).

### 3.4 Burst

5-minute ramp to 2× steady rate, hold 10 minutes, ramp down. Watch lock wait on advisory skill-pool locks and `open_ticket_count` correctness.

---

## 4. Tooling (suggested)

- **k6** or **Locust** for HTTP once API exists; until then, **pgbench**-style SQL scripts or Python `asyncpg` pools with `SET LOCAL`.
- Prometheus metrics: timer lag, outbox depth, assign latency, RLS denial count.
- Postgres: `pg_stat_activity`, `pg_locks`, partial index usage on `ticket_timers_due_idx` / `outbox_pending_idx`.

---

## 5. Data volume / partitioning check

At 25k tickets/day ≈ 750k tickets/month; events often 5–15× tickets. Confirm monthly partitions (or partition plan) for `ticket_events`, `outbox_events`, `audit_log` before production cutover. This load test should run long enough to fill ≥ 1 day of events and verify insert rate on the hot partition.

---

## 6. Exit

Share results (latency histograms, lag, isolation proof, double-fire count) in the review meeting. **Do not start FastAPI build** until criteria above pass or are explicitly waived by the platform owner.
