-- PropDesk schema tests — final closeout (Ravi Nov 12 full checklist)
-- psql $DATABASE_URL -v ON_ERROR_STOP=1 -f schema.sql -f schema_tests.sql

BEGIN;

DO $$
DECLARE
  ent uuid; ent_b uuid; cal uuid; region uuid; prop uuid; unit uuid;
  tenant uuid; lease uuid; cat_heat uuid; cat_parent uuid; cat_leaf uuid;
  role_super uuid; role_t1 uuid; role_t2 uuid; role_t3 uuid;
  u_olivia uuid; u_ruth uuid; u_priya uuid; u_dana uuid; u_marcus uuid;
  chain uuid; chain_parent uuid; lvl0 uuid; lvl1 uuid; hold_reason uuid;
  ticket uuid; ticket2 uuid; tnum text; tnum2 text; t tickets%ROWTYPE;
  primary_a uuid; primary_b uuid; n int; pred uuid; timer uuid;
  due_dst timestamptz; action text;
BEGIN
  INSERT INTO enterprises (name, slug) VALUES ('PropDesk Demo', 'propdesk-demo') RETURNING id INTO ent;
  PERFORM set_config('app.enterprise_id', ent::text, true);

  INSERT INTO licenses (enterprise_id, plan, seats, price_per_seat, expires_on, is_current)
  VALUES (ent, 'Starter', 10, 12, DATE '2027-09-30', true);
  INSERT INTO enterprise_settings (enterprise_id, ticket_prefix, auto_close_days, reopen_window_days, at_risk_pct, ai_routing_mode, ai_confidence_threshold, ai_priority_raise_cap)
  VALUES (ent, 'HD', 7, 14, 25, 'auto', 85, 1);
  INSERT INTO enterprise_counters (enterprise_id, next_ticket_n) VALUES (ent, 1);

  INSERT INTO business_calendars (enterprise_id, name, timezone, is_default)
  VALUES (ent, 'UK Standard', 'Europe/London', true) RETURNING id INTO cal;
  -- Split shift Monday (weekday 0): morning + afternoon
  INSERT INTO business_hours (enterprise_id, calendar_id, weekday, opens_at, closes_at) VALUES
    (ent, cal, 0, TIME '09:00', TIME '12:00'),
    (ent, cal, 0, TIME '13:00', TIME '17:00');
  INSERT INTO business_hours (enterprise_id, calendar_id, weekday, opens_at, closes_at)
  SELECT ent, cal, d, TIME '09:00', TIME '17:00' FROM generate_series(1, 4) AS d;

  INSERT INTO regions (enterprise_id, name) VALUES (ent, 'South') RETURNING id INTO region;
  INSERT INTO properties (enterprise_id, region_id, name, timezone, calendar_id)
  VALUES (ent, region, 'The Foundry', 'Europe/London', cal) RETURNING id INTO prop;
  INSERT INTO units (enterprise_id, property_id, code) VALUES (ent, prop, '4B') RETURNING id INTO unit;
  INSERT INTO tenants (enterprise_id, full_name, email) VALUES (ent, 'Maya Patel', 'maya.patel@example.com') RETURNING id INTO tenant;
  INSERT INTO leases (enterprise_id, tenant_id, unit_id, lease_ref, starts_on, status)
  VALUES (ent, tenant, unit, 'L-10482', DATE '2023-01-01', 'Active') RETURNING id INTO lease;

  INSERT INTO categories (enterprise_id, depth, name, respond_mins, resolve_mins)
  VALUES (ent, 'category', 'Facilities', 120, 960) RETURNING id INTO cat_parent;
  INSERT INTO categories (enterprise_id, parent_id, depth, name, respond_mins, resolve_mins)
  VALUES (ent, cat_parent, 'sub_category', 'Heating', 60, 480) RETURNING id INTO cat_heat;
  cat_leaf := cat_heat;

  INSERT INTO sla_policies (enterprise_id, category_id, name, respond_mins, resolve_mins, is_default) VALUES
    (ent, cat_heat, 'Heating', 60, 480, false),
    (ent, NULL, 'Default', 240, 1440, true);
  INSERT INTO priority_rules (enterprise_id, priority, multiplier, runs_24_7) VALUES
    (ent, 'Urgent', 0.25, true), (ent, 'High', 0.5, false),
    (ent, 'Normal', 1.0, false), (ent, 'Low', 2.0, false);

  INSERT INTO roles (enterprise_id, code, name, rank, is_system) VALUES (ent, 'super', 'Super Admin', 100, true) RETURNING id INTO role_super;
  INSERT INTO roles (enterprise_id, code, name, rank) VALUES (ent, 't1', 'Type 1', 60) RETURNING id INTO role_t1;
  INSERT INTO roles (enterprise_id, code, name, rank) VALUES (ent, 't2', 'Type 2', 40) RETURNING id INTO role_t2;
  INSERT INTO roles (enterprise_id, code, name, rank) VALUES (ent, 't3', 'Type 3', 20) RETURNING id INTO role_t3;

  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_super, 'Olivia Price', 'olivia@example.com', 'Available', 0) RETURNING id INTO u_olivia;
  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_t1, 'Ruth Allen', 'ruth@example.com', 'Available', 0) RETURNING id INTO u_ruth;
  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_t2, 'Priya Shah', 'priya@example.com', 'On call', 0) RETURNING id INTO u_priya;
  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_t3, 'Dana Hughes', 'dana@example.com', 'Available', 0) RETURNING id INTO u_dana;
  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_t3, 'Marcus Lee', 'marcus@example.com', 'Available', 0) RETURNING id INTO u_marcus;
  INSERT INTO user_skills (enterprise_id, user_id, category_id) VALUES (ent, u_dana, cat_heat), (ent, u_marcus, cat_heat);

  -- Parent-category chain (no leaf-specific chain) — tree walk must find it
  INSERT INTO escalation_chains (enterprise_id, category_id, name, version, status, triggers)
  VALUES (ent, cat_parent, 'Facilities chain', 1, 'published', ARRAY['sla_breach','ack_timeout','unassigned'])
  RETURNING id INTO chain_parent;
  INSERT INTO escalation_levels (enterprise_id, chain_id, level_no, ack_mins, mode, workload_cap, nobody_free)
  VALUES (ent, chain_parent, 0, 30, 'sequential', 50, 'escalate') RETURNING id INTO lvl0;
  INSERT INTO escalation_levels (enterprise_id, chain_id, level_no, ack_mins, mode, workload_cap, nobody_free)
  VALUES (ent, chain_parent, 1, 30, 'sequential', 50, 'escalate') RETURNING id INTO lvl1;
  INSERT INTO escalation_levels (enterprise_id, chain_id, level_no, ack_mins, mode)
  VALUES (ent, chain_parent, 2, 15, 'parallel');
  INSERT INTO escalation_level_roles (enterprise_id, level_id, role_id) VALUES (ent, lvl1, role_t2);
  INSERT INTO escalation_severity_rules (enterprise_id, chain_id, min_severity, skip_to_level, window_factor, force_24_7)
  VALUES (ent, chain_parent, 'Critical', 2, 0.5, true);

  INSERT INTO hold_reasons (enterprise_id, code, label, waiting_on, limit_mins, pauses_tenant_sla)
  VALUES (ent, 'await_tenant', 'Waiting on tenant', 'tenant', 120, true) RETURNING id INTO hold_reason;

  -- §1.1 / counter upsert
  UPDATE enterprise_counters SET next_ticket_n = 100000 WHERE enterprise_id = ent;
  tnum := next_ticket_number(ent);
  tnum2 := next_ticket_number(ent);
  IF tnum <> 'HD-100000' OR tnum2 <> 'HD-100001' THEN
    RAISE EXCEPTION '1.1/1.2 expected HD-100000 then HD-100001 got % %', tnum, tnum2;
  END IF;

  -- Empty hours raise
  BEGIN
    PERFORM add_business_minutes(ent, gen_random_uuid(), now(), 60);
    RAISE EXCEPTION 'empty calendar should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%business_hours%' THEN RAISE; END IF;
  END;

  -- Parent-category chain walk + create_ticket
  ticket := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Inbound call',
    'No heating', 'Boiler failed', 'Normal', u_olivia);
  SELECT * INTO t FROM tickets WHERE id = ticket;
  IF t.chain_id IS DISTINCT FROM chain_parent THEN
    RAISE EXCEPTION 'category-tree chain walk failed, got %', t.chain_id;
  END IF;

  -- DST: spring forward 2026-03-29 Europe/London — start Saturday evening, business mins into Monday
  UPDATE tickets SET
    priority = 'Normal', first_response_at = NULL, pause_total_mins = 0,
    clock_started_at = timestamptz '2026-03-27 16:00:00+00'
  WHERE id = ticket;
  PERFORM apply_ticket_policy(ent, ticket);
  SELECT tenant_respond_due INTO due_dst FROM tickets WHERE id = ticket;
  IF due_dst IS NULL THEN RAISE EXCEPTION 'DST due missing'; END IF;
  -- Due must land in London local after open, not raw UTC+240m
  IF (due_dst AT TIME ZONE 'Europe/London')::date < DATE '2026-03-30' THEN
    RAISE EXCEPTION 'DST/business due too early: %', due_dst;
  END IF;

  -- Cross-tenant
  INSERT INTO enterprises (name, slug) VALUES ('Other', 'other-co') RETURNING id INTO ent_b;
  PERFORM set_config('app.enterprise_id', ent_b::text, true);
  INSERT INTO enterprise_settings (enterprise_id, ticket_prefix) VALUES (ent_b, 'OT');
  INSERT INTO licenses (enterprise_id, plan, seats, price_per_seat, expires_on, is_current)
  VALUES (ent_b, 'Starter', 5, 10, DATE '2027-01-01', true);
  BEGIN
    PERFORM create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'x', 'n', 'Normal', NULL);
    RAISE EXCEPTION 'cross-tenant create_ticket should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%TENANT%' AND SQLERRM NOT LIKE '%enterprise%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM escalate_ticket(ent, ticket);
    RAISE EXCEPTION 'cross-tenant escalate should fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%TENANT%' AND SQLERRM NOT LIKE '%enterprise%' THEN RAISE; END IF;
  END;
  PERFORM set_config('app.enterprise_id', ent::text, true);

  -- Urgent respond ~15m
  ticket := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'Heating', 'notes', 'Urgent', u_olivia);
  PERFORM pick_and_assign(ent, ticket, 'initial_route');
  SELECT * INTO t FROM tickets WHERE id = ticket;
  IF t.primary_user_id IS NULL THEN RAISE EXCEPTION 'expected primary'; END IF;
  IF ABS(EXTRACT(EPOCH FROM (t.tenant_respond_due - t.clock_started_at))/60.0 - 15) > 1 THEN
    RAISE EXCEPTION 'Urgent Heating respond not ~15m';
  END IF;

  -- Hold cancels SLA; restore status; no respond re-arm; resolve at-risk
  PERFORM start_hold(ent, ticket, hold_reason, u_olivia);
  IF EXISTS (
    SELECT 1 FROM ticket_timers
    WHERE ticket_id = ticket AND kind IN ('tenant_respond','tenant_resolve','at_risk')
      AND cancelled_at IS NULL AND consumed_at IS NULL
  ) THEN RAISE EXCEPTION '2.1 SLA timers should cancel on hold'; END IF;
  PERFORM end_hold(ent, ticket);
  UPDATE tickets SET first_response_at = now(), pause_total_mins = 0 WHERE id = ticket;
  PERFORM apply_ticket_policy(ent, ticket);
  IF EXISTS (
    SELECT 1 FROM ticket_timers WHERE ticket_id = ticket AND kind = 'tenant_respond'
      AND cancelled_at IS NULL AND consumed_at IS NULL
  ) THEN RAISE EXCEPTION '2.2 respond re-armed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ticket_timers WHERE ticket_id = ticket AND kind = 'at_risk'
      AND payload->>'window' = 'resolve' AND cancelled_at IS NULL AND consumed_at IS NULL
  ) THEN RAISE EXCEPTION 'resolve at-risk missing'; END IF;

  -- Dual assign different primaries + open counts
  UPDATE users SET open_ticket_count = 0, availability = 'Available', busy_until = NULL, unavailable_until = NULL
  WHERE enterprise_id = ent AND id IN (u_dana, u_marcus);
  ticket := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'A', 'n', 'Normal', u_olivia);
  ticket2 := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'B', 'n', 'Normal', u_olivia);
  PERFORM pick_and_assign(ent, ticket, 'initial_route');
  PERFORM pick_and_assign(ent, ticket2, 'initial_route');
  SELECT primary_user_id INTO primary_a FROM tickets WHERE id = ticket;
  SELECT primary_user_id INTO primary_b FROM tickets WHERE id = ticket2;
  IF primary_a IS NULL OR primary_b IS NULL OR primary_a = primary_b THEN
    RAISE EXCEPTION '3.6 expected different primaries';
  END IF;
  IF (SELECT open_ticket_count FROM users WHERE id = primary_a) < 1 THEN
    RAISE EXCEPTION 'open_ticket_count not maintained';
  END IF;

  -- Exhausted escalate
  UPDATE users SET open_ticket_count = 0, availability = 'Available', busy_until = NULL, unavailable_until = NULL
  WHERE enterprise_id = ent AND id IN (u_dana, u_marcus);
  ticket := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'Esc', 'n', 'Urgent', u_olivia);
  PERFORM pick_and_assign(ent, ticket, 'initial_route');
  UPDATE tickets SET first_response_at = now(), status = 'In Progress' WHERE id = ticket;
  PERFORM escalate_ticket(ent, ticket);
  PERFORM escalate_ticket(ent, ticket);
  PERFORM escalate_ticket(ent, ticket);
  SELECT escalation_state INTO t.escalation_state FROM tickets WHERE id = ticket;
  IF t.escalation_state <> 'exhausted' THEN RAISE EXCEPTION 'expected exhausted'; END IF;

  -- Severity skip to level 2
  UPDATE users SET open_ticket_count = 0, availability = 'Available' WHERE id IN (u_dana, u_marcus);
  ticket := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'Sev', 'n', 'Urgent', u_olivia);
  UPDATE tickets SET severity = 'Critical', first_response_at = now(), status = 'In Progress' WHERE id = ticket;
  n := escalate_ticket(ent, ticket);
  IF n <> 2 THEN RAISE EXCEPTION 'severity skip expected level 2 got %', n; END IF;

  -- Breach timestamp via act_and_consume_timer
  ticket := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'Br', 'n', 'Urgent', u_olivia);
  UPDATE ticket_timers SET fires_at = now() - interval '1 minute'
  WHERE ticket_id = ticket AND kind = 'tenant_respond' AND cancelled_at IS NULL;
  SELECT id INTO timer FROM ticket_timers
  WHERE ticket_id = ticket AND kind = 'tenant_respond' AND cancelled_at IS NULL LIMIT 1;
  action := act_and_consume_timer(ent, timer);
  SELECT respond_breached_at INTO t.respond_breached_at FROM tickets WHERE id = ticket;
  IF t.respond_breached_at IS NULL THEN RAISE EXCEPTION 'respond_breached_at not set (% )', action; END IF;
  -- Double consume idempotent
  action := act_and_consume_timer(ent, timer);
  IF action <> 'already_done' THEN RAISE EXCEPTION 'double consume expected already_done got %', action; END IF;

  -- Busy restore
  UPDATE users SET availability = 'Unavailable', busy_until = now() - interval '1 second',
    unavailable_until = now() - interval '1 second' WHERE id = u_dana;
  PERFORM handle_busy_until(ent, u_dana);
  IF (SELECT availability FROM users WHERE id = u_dana) <> 'Available' THEN
    RAISE EXCEPTION 'busy restore failed';
  END IF;

  -- AI auto below threshold → triage
  ticket := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'AI', 'n', 'Normal', u_olivia);
  INSERT INTO ai_predictions (enterprise_id, ticket_id, category_id, predicted_priority, confidence, routing_mode, model_name, prompt_version)
  VALUES (ent, ticket, cat_heat, 'High', 50, 'auto', 'test-model', 'v1') RETURNING id INTO pred;
  PERFORM apply_ai_prediction(ent, pred);
  IF NOT (SELECT needs_triage FROM tickets WHERE id = ticket) THEN
    RAISE EXCEPTION 'AI low confidence should triage';
  END IF;

  -- AI raise cap: Normal + predicted Urgent with cap 1 → High
  UPDATE tickets SET needs_triage = false, priority = 'Normal' WHERE id = ticket;
  INSERT INTO ai_predictions (enterprise_id, ticket_id, category_id, predicted_priority, confidence, routing_mode, model_name, prompt_version)
  VALUES (ent, ticket, cat_heat, 'Urgent', 99, 'auto', 'test-model', 'v1') RETURNING id INTO pred;
  PERFORM apply_ai_prediction(ent, pred);
  SELECT priority, needs_triage INTO t.priority, t.needs_triage FROM tickets WHERE id = ticket;
  IF t.priority <> 'High' OR t.needs_triage THEN
    RAISE EXCEPTION 'AI raise cap expected High, got % triage=%', t.priority, t.needs_triage;
  END IF;

  -- Non-leaf → triage
  INSERT INTO ai_predictions (enterprise_id, ticket_id, category_id, predicted_priority, confidence, routing_mode)
  VALUES (ent, ticket, cat_parent, 'Normal', 99, 'auto') RETURNING id INTO pred;
  PERFORM apply_ai_prediction(ent, pred);
  IF NOT (SELECT needs_triage FROM tickets WHERE id = ticket) THEN
    RAISE EXCEPTION 'non-leaf should triage';
  END IF;

  -- Licence expired blocks create
  UPDATE licenses SET is_current = false WHERE enterprise_id = ent;
  INSERT INTO licenses (enterprise_id, plan, seats, price_per_seat, starts_on, expires_on, grace_days, is_current)
  VALUES (ent, 'Starter', 10, 12, DATE '2020-01-01', DATE '2020-06-01', 0, true);
  BEGIN
    PERFORM create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'Lic', 'n', 'Normal', u_olivia);
    RAISE EXCEPTION 'expired licence should block create';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%LICENCE%' THEN RAISE; END IF;
  END;
  UPDATE licenses SET is_current = false WHERE enterprise_id = ent AND is_current;
  INSERT INTO licenses (enterprise_id, plan, seats, price_per_seat, expires_on, is_current)
  VALUES (ent, 'Starter', 10, 12, DATE '2027-09-30', true);

  -- Anonymise keeps audit
  n := (SELECT count(*)::int FROM audit_log WHERE enterprise_id = ent);
  PERFORM anonymise_tenant(ent, tenant);
  IF (SELECT email FROM tenants WHERE id = tenant) NOT LIKE '%anonymised%' THEN
    RAISE EXCEPTION 'tenant not anonymised';
  END IF;
  IF (SELECT count(*)::int FROM audit_log WHERE enterprise_id = ent AND action = 'anonymised') < 1 THEN
    RAISE EXCEPTION 'anonymise audit missing';
  END IF;

  -- Partition inserts succeed (events already inserted via record_event)
  IF (SELECT count(*) FROM ticket_events WHERE enterprise_id = ent) < 1 THEN
    RAISE EXCEPTION 'partitioned ticket_events empty';
  END IF;

  -- Handoff freeze
  UPDATE users SET open_ticket_count = 0, availability = 'Available' WHERE id IN (u_dana, u_marcus);
  ticket := create_ticket(ent, prop, unit, tenant, lease, cat_heat, 'Call', 'Frz', 'n', 'Urgent', u_olivia);
  PERFORM pick_and_assign(ent, ticket, 'initial_route');
  SELECT primary_user_id INTO primary_a FROM tickets WHERE id = ticket;
  UPDATE tickets SET first_response_at = now(), status = 'On Hold' WHERE id = ticket;
  BEGIN
    PERFORM decline_assignment(ent, ticket, primary_a);
    RAISE EXCEPTION 'decline should freeze';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%HANDOFF_FROZEN%' AND SQLERRM NOT LIKE '%frozen%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL final closeout schema tests passed';
END;
$$;

ROLLBACK;
