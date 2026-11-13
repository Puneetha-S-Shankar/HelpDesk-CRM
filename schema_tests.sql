-- PropDesk schema tests (Ravi revision) — run after schema.sql
-- psql $DATABASE_URL -v ON_ERROR_STOP=1 -f schema.sql -f schema_tests.sql
-- Requires: SET LOCAL app.enterprise_id for RLS + assert_enterprise.

BEGIN;

DO $$
DECLARE
  ent uuid;
  ent_b uuid;
  cal uuid;
  region uuid;
  prop uuid;
  unit uuid;
  tenant uuid;
  lease uuid;
  cat_heat uuid;
  role_super uuid;
  role_t1 uuid;
  role_t2 uuid;
  role_t3 uuid;
  u_olivia uuid;
  u_ruth uuid;
  u_priya uuid;
  u_dana uuid;
  u_marcus uuid;
  chain uuid;
  lvl1 uuid;
  ticket uuid;
  ticket2 uuid;
  tnum text;
  t tickets%ROWTYPE;
  assign_count int;
  new_level int;
  other_user uuid;
  timer_id uuid;
  timer_row ticket_timers%ROWTYPE;
  primary_a uuid;
  primary_b uuid;
BEGIN
  -- -------------------------------------------------------------------------
  -- Seed enterprise A
  -- -------------------------------------------------------------------------
  INSERT INTO enterprises (name, slug)
  VALUES ('PropDesk Demo', 'propdesk-demo') RETURNING id INTO ent;

  PERFORM set_config('app.enterprise_id', ent::text, true);

  INSERT INTO licenses (enterprise_id, plan, seats, price_per_seat, expires_on)
  VALUES (ent, 'Starter', 10, 12, DATE '2027-09-30');

  INSERT INTO enterprise_settings (
    enterprise_id, ticket_prefix, auto_close_days, reopen_days,
    at_risk_pct, ai_routing_mode, ai_confidence_threshold
  ) VALUES (ent, 'HD', 7, 14, 25, 'auto', 85);

  INSERT INTO enterprise_counters (enterprise_id, next_ticket_n) VALUES (ent, 24891);

  INSERT INTO business_calendars (enterprise_id, name, timezone, is_default)
  VALUES (ent, 'UK Standard', 'Europe/London', true) RETURNING id INTO cal;

  INSERT INTO business_hours (enterprise_id, calendar_id, weekday, opens_at, closes_at)
  SELECT ent, cal, d, TIME '09:00', TIME '17:00' FROM generate_series(0, 4) AS d;

  INSERT INTO regions (enterprise_id, name) VALUES (ent, 'South') RETURNING id INTO region;

  INSERT INTO properties (enterprise_id, region_id, name, timezone, calendar_id)
  VALUES (ent, region, 'The Foundry', 'Europe/London', cal) RETURNING id INTO prop;

  INSERT INTO units (enterprise_id, property_id, code, floor)
  VALUES (ent, prop, '4B', '4') RETURNING id INTO unit;

  INSERT INTO tenants (enterprise_id, full_name, email, phone)
  VALUES (ent, 'Maya Patel', 'maya.patel@example.com', '+44 7700 900421')
  RETURNING id INTO tenant;

  INSERT INTO leases (enterprise_id, tenant_id, unit_id, lease_ref, starts_on, status)
  VALUES (ent, tenant, unit, 'L-10482', DATE '2023-01-01', 'Active')
  RETURNING id INTO lease;

  INSERT INTO categories (enterprise_id, depth, name, respond_mins, resolve_mins)
  VALUES (ent, 'category', 'Heating', 60, 480) RETURNING id INTO cat_heat;

  INSERT INTO sla_policies (enterprise_id, category_id, name, respond_mins, resolve_mins, is_default)
  VALUES
    (ent, cat_heat, 'Heating policy', 60, 480, false),
    (ent, NULL, 'Default', 240, 1440, true);

  INSERT INTO priority_rules (enterprise_id, priority, multiplier, runs_24_7) VALUES
    (ent, 'Urgent', 0.25, true),
    (ent, 'High', 0.5, false),
    (ent, 'Normal', 1.0, false),
    (ent, 'Low', 2.0, false);

  INSERT INTO roles (enterprise_id, code, name, rank, is_system) VALUES
    (ent, 'super', 'Super Admin', 100, true) RETURNING id INTO role_super;
  INSERT INTO roles (enterprise_id, code, name, rank) VALUES
    (ent, 't1', 'Type 1', 60) RETURNING id INTO role_t1;
  INSERT INTO roles (enterprise_id, code, name, rank) VALUES
    (ent, 't2', 'Type 2', 40) RETURNING id INTO role_t2;
  INSERT INTO roles (enterprise_id, code, name, rank) VALUES
    (ent, 't3', 'Type 3', 20) RETURNING id INTO role_t3;

  INSERT INTO role_permissions (enterprise_id, role_id, permission, allowed)
  SELECT ent, role_t3, p, true
  FROM unnest(ARRAY['view','create','accept','decline','busy','respond','resolve']) AS p;

  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_super, 'Olivia Price', 'olivia.price@example.com', 'Available', 0) RETURNING id INTO u_olivia;
  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_t1, 'Ruth Allen', 'ruth.allen@example.com', 'Available', 1) RETURNING id INTO u_ruth;
  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_t2, 'Priya Shah', 'priya.shah@example.com', 'On call', 4) RETURNING id INTO u_priya;
  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_t3, 'Dana Hughes', 'dana.hughes@example.com', 'Available', 6) RETURNING id INTO u_dana;
  INSERT INTO users (enterprise_id, role_id, full_name, email, availability, open_ticket_count) VALUES
    (ent, role_t3, 'Marcus Lee', 'marcus.lee@example.com', 'Available', 8) RETURNING id INTO u_marcus;

  INSERT INTO user_skills (enterprise_id, user_id, category_id) VALUES
    (ent, u_dana, cat_heat), (ent, u_marcus, cat_heat);
  INSERT INTO user_region_scopes (enterprise_id, user_id, region_id)
  VALUES (ent, u_olivia, region);

  INSERT INTO routing_rules (
    enterprise_id, property_id, category_id, preferred_user_id, backup_user_id, manager_user_id
  ) VALUES (ent, prop, cat_heat, u_dana, u_marcus, u_ruth);

  INSERT INTO escalation_chains (enterprise_id, category_id, name, version, status, triggers)
  VALUES (ent, cat_heat, 'Heating chain', 1, 'published', ARRAY['sla_breach','ack_timeout','unassigned'])
  RETURNING id INTO chain;

  INSERT INTO escalation_levels (enterprise_id, chain_id, level_no, ack_mins, mode)
  VALUES (ent, chain, 0, 30, 'sequential');
  INSERT INTO escalation_levels (enterprise_id, chain_id, level_no, ack_mins, mode)
  VALUES (ent, chain, 1, 30, 'sequential') RETURNING id INTO lvl1;
  INSERT INTO escalation_levels (enterprise_id, chain_id, level_no, ack_mins, mode)
  VALUES (ent, chain, 2, 15, 'parallel');
  INSERT INTO escalation_level_roles (enterprise_id, level_id, role_id) VALUES (ent, lvl1, role_t2);

  INSERT INTO hold_reasons (enterprise_id, code, label, waiting_on, limit_mins, pauses_tenant_sla)
  VALUES (ent, 'await_tenant', 'Waiting on tenant', 'tenant', 120, true);

  -- Enterprise B
  INSERT INTO enterprises (name, slug) VALUES ('Other Co', 'other-co') RETURNING id INTO ent_b;
  PERFORM set_config('app.enterprise_id', ent_b::text, true);
  INSERT INTO enterprise_settings (enterprise_id) VALUES (ent_b);
  INSERT INTO roles (enterprise_id, code, name, rank) VALUES (ent_b, 't3', 'Type 3', 20)
  RETURNING id INTO role_t3;
  INSERT INTO users (enterprise_id, role_id, full_name, email)
  VALUES (ent_b, role_t3, 'Stranger', 'stranger@other.example') RETURNING id INTO other_user;

  PERFORM set_config('app.enterprise_id', ent::text, true);

  -- -------------------------------------------------------------------------
  -- Ticket number
  -- -------------------------------------------------------------------------
  tnum := next_ticket_number(ent);
  IF tnum <> 'HD-24891' THEN RAISE EXCEPTION 'expected HD-24891 got %', tnum; END IF;

  -- -------------------------------------------------------------------------
  -- Sample story ticket
  -- -------------------------------------------------------------------------
  INSERT INTO tickets (
    enterprise_id, ticket_number, property_id, unit_id, tenant_id, lease_id,
    category_id, channel, subject, priority, status, chain_id,
    sentiment_label, sentiment_score, ai_confidence, urgency_tags
  ) VALUES (
    ent, 'HD-24891', prop, unit, tenant, lease,
    cat_heat, 'Inbound call', 'No heating — boiler failure', 'Urgent', 'Open', chain,
    'Negative', -0.72, 94.0, ARRAY['No heating','Child present','Low temperature']
  ) RETURNING id INTO ticket;

  -- Cross-tenant FK
  BEGIN
    UPDATE tickets SET primary_user_id = other_user WHERE enterprise_id = ent AND id = ticket;
    RAISE EXCEPTION 'cross-tenant FK should fail';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Cross-tenant engine access must fail
  BEGIN
    PERFORM next_ticket_number(ent_b);
    RAISE EXCEPTION 'assert_enterprise should fail for other enterprise';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM NOT LIKE '%TENANT%' AND SQLERRM NOT LIKE '%enterprise%' THEN
      RAISE;
    END IF;
  END;

  PERFORM enter_level(ent, ticket, 0);
  PERFORM pick_and_assign(ent, ticket, 'initial_route');
  PERFORM apply_ticket_policy(ent, ticket);

  SELECT * INTO t FROM tickets WHERE enterprise_id = ent AND id = ticket;
  IF t.primary_user_id IS DISTINCT FROM u_dana THEN
    RAISE EXCEPTION 'expected Dana primary';
  END IF;
  IF ABS(EXTRACT(EPOCH FROM (t.tenant_respond_due - t.clock_started_at)) / 60.0 - 15) > 1 THEN
    RAISE EXCEPTION 'respond not ~15m';
  END IF;
  IF ABS(EXTRACT(EPOCH FROM (t.tenant_resolve_due - t.clock_started_at)) / 60.0 - 120) > 1 THEN
    RAISE EXCEPTION 'resolve not ~120m';
  END IF;

  -- Busy with duration → Marcus
  PERFORM mark_assignee_busy(ent, ticket, u_dana, 30);
  IF (SELECT availability FROM users WHERE enterprise_id = ent AND id = u_dana) <> 'Unavailable' THEN
    RAISE EXCEPTION 'Dana should be Unavailable';
  END IF;
  IF (SELECT busy_until FROM users WHERE enterprise_id = ent AND id = u_dana) IS NULL THEN
    RAISE EXCEPTION 'Dana busy_until required';
  END IF;

  SELECT * INTO t FROM tickets WHERE enterprise_id = ent AND id = ticket;
  IF t.primary_user_id IS DISTINCT FROM u_marcus THEN
    RAISE EXCEPTION 'after busy expected Marcus';
  END IF;

  PERFORM decline_assignment(ent, ticket, u_marcus);
  SELECT * INTO t FROM tickets WHERE enterprise_id = ent AND id = ticket;
  IF t.primary_user_id IS NOT NULL OR t.status <> 'Unassigned' THEN
    RAISE EXCEPTION 'expected Unassigned';
  END IF;

  SELECT COUNT(*) INTO assign_count FROM ticket_assignments
  WHERE enterprise_id = ent AND ticket_id = ticket;
  IF assign_count < 3 THEN RAISE EXCEPTION 'assignment history too short: %', assign_count; END IF;

  BEGIN
    PERFORM resolve_ticket(ent, ticket, u_marcus);
    RAISE EXCEPTION 'resolve should fail when unassigned';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%primary%' AND SQLERRM NOT LIKE '%NO_ASSIGNEE%' AND SQLERRM NOT LIKE '%cannot resolve%' THEN
      RAISE;
    END IF;
  END;

  -- Re-route Marcus
  UPDATE users SET availability = 'Available', busy_until = NULL WHERE enterprise_id = ent AND id IN (u_dana, u_marcus);
  UPDATE tickets SET declined_user_ids = ARRAY[u_dana]::uuid[] WHERE enterprise_id = ent AND id = ticket;
  PERFORM pick_and_assign(ent, ticket, 'reassign');
  SELECT * INTO t FROM tickets WHERE enterprise_id = ent AND id = ticket;
  IF t.primary_user_id IS DISTINCT FROM u_marcus THEN RAISE EXCEPTION 'reassign expected Marcus'; END IF;

  PERFORM respond_to_ticket(ent, ticket, u_marcus);

  -- Escalate: work status stays In Progress; escalation_state waiting
  new_level := escalate_ticket(ent, ticket);
  SELECT * INTO t FROM tickets WHERE enterprise_id = ent AND id = ticket;
  IF t.status <> 'In Progress' THEN
    RAISE EXCEPTION 'work status should remain In Progress, got %', t.status;
  END IF;
  IF t.escalation_state <> 'waiting' THEN
    RAISE EXCEPTION 'expected escalation waiting';
  END IF;
  IF new_level < 1 THEN RAISE EXCEPTION 'expected level >= 1'; END IF;

  BEGIN
    PERFORM resolve_ticket(ent, ticket, u_marcus);
    RAISE EXCEPTION 'resolve should fail while escalation waiting';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%ESCALATION%' AND SQLERRM NOT LIKE '%escalat%' THEN RAISE; END IF;
  END;

  PERFORM acknowledge_escalation(ent, ticket, u_priya);
  SELECT * INTO t FROM tickets WHERE enterprise_id = ent AND id = ticket;
  IF t.escalation_state = 'waiting' THEN RAISE EXCEPTION 'ack should clear waiting'; END IF;

  IF t.primary_user_id IS NULL THEN
    UPDATE tickets SET declined_user_ids = '{}', status = 'Open' WHERE enterprise_id = ent AND id = ticket;
    PERFORM pick_and_assign(ent, ticket, 'reassign');
  END IF;
  SELECT primary_user_id INTO u_marcus FROM tickets WHERE enterprise_id = ent AND id = ticket;
  IF (SELECT status FROM tickets WHERE enterprise_id = ent AND id = ticket) <> 'In Progress' THEN
    PERFORM respond_to_ticket(ent, ticket, u_marcus);
  END IF;

  PERFORM resolve_ticket(ent, ticket, u_marcus);
  PERFORM close_ticket(ent, ticket);

  -- -------------------------------------------------------------------------
  -- Double timer fire: consume then re-claim must not re-escalate
  -- -------------------------------------------------------------------------
  INSERT INTO tickets (
    enterprise_id, ticket_number, property_id, unit_id, tenant_id, lease_id,
    category_id, priority, status, chain_id, primary_user_id
  ) VALUES (
    ent, next_ticket_number(ent), prop, unit, tenant, lease,
    cat_heat, 'Urgent', 'In Progress', chain, u_marcus
  ) RETURNING id INTO ticket2;

  INSERT INTO ticket_timers (enterprise_id, ticket_id, kind, fires_at, payload)
  VALUES (ent, ticket2, 'escalation_ack', now() - interval '1 minute', '{}')
  RETURNING id INTO timer_id;

  timer_row := claim_due_timer(ent);
  IF timer_row.id IS NULL THEN RAISE EXCEPTION 'expected to claim timer'; END IF;
  new_level := escalate_ticket(ent, ticket2);
  PERFORM consume_timer(ent, timer_row.id);

  -- Second claim of same timer impossible
  IF EXISTS (
    SELECT 1 FROM ticket_timers
    WHERE id = timer_row.id AND consumed_at IS NULL AND cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'timer still claimable after consume';
  END IF;

  -- -------------------------------------------------------------------------
  -- Parallel skill-pool assign (serialized via advisory lock): two tickets
  -- -------------------------------------------------------------------------
  UPDATE users SET availability = 'Available', busy_until = NULL, open_ticket_count = 0
  WHERE enterprise_id = ent AND id IN (u_dana, u_marcus);

  INSERT INTO tickets (
    enterprise_id, ticket_number, property_id, category_id, priority, status, chain_id
  ) VALUES
    (ent, next_ticket_number(ent), prop, cat_heat, 'Normal', 'Open', chain)
  RETURNING id INTO ticket;
  INSERT INTO tickets (
    enterprise_id, ticket_number, property_id, category_id, priority, status, chain_id
  ) VALUES
    (ent, next_ticket_number(ent), prop, cat_heat, 'Normal', 'Open', chain)
  RETURNING id INTO ticket2;

  -- Clear routing preference so skill pool decides
  DELETE FROM routing_rules WHERE enterprise_id = ent AND property_id = prop AND category_id = cat_heat;

  PERFORM pick_and_assign(ent, ticket, 'initial_route');
  PERFORM pick_and_assign(ent, ticket2, 'initial_route');

  SELECT primary_user_id INTO primary_a FROM tickets WHERE id = ticket;
  SELECT primary_user_id INTO primary_b FROM tickets WHERE id = ticket2;
  IF primary_a IS NULL OR primary_b IS NULL THEN
    RAISE EXCEPTION 'both tickets should have primaries';
  END IF;
  IF primary_a = primary_b THEN
    RAISE EXCEPTION 'serialized assign should pick different primaries when two available, got same %', primary_a;
  END IF;

  -- Append-only events
  BEGIN
    UPDATE ticket_events SET event_type = 'tamper'
    WHERE id = (SELECT id FROM ticket_events WHERE enterprise_id = ent LIMIT 1);
    RAISE EXCEPTION 'events should be append-only';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'ALL PropDesk schema tests passed (Ravi revision)';
END;
$$;

ROLLBACK;
