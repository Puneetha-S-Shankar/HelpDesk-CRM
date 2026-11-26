-- PropDesk Helpdesk CRM — PostgreSQL 16+ schema (final closeout)
-- Companion: SCHEMA.md · docs/LLD.md · docs/LOAD_TEST.md · schema_tests.sql
-- Shared DB + RLS (SET LOCAL app.enterprise_id). Composite FKs on enterprise_id.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE priority_code AS ENUM ('Urgent', 'High', 'Normal', 'Low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE availability_code AS ENUM ('Available', 'On call', 'Unavailable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM (
    'Open', 'In Progress', 'On Hold', 'Unassigned', 'Resolved', 'Closed', 'Cancelled', 'Duplicate'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE escalation_state AS ENUM ('none', 'waiting', 'acked', 'exhausted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ai_routing_mode AS ENUM ('auto', 'human_review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE assignment_reason AS ENUM (
    'initial_route', 'declined', 'busy', 'reassign', 'escalate_ack', 'import'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE escalation_mode AS ENUM ('sequential', 'parallel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE category_depth AS ENUM ('category', 'sub_category', 'type', 'sub_type');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_kind AS ENUM ('Asset', 'Area', 'Location');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE comment_visibility AS ENUM ('tenant', 'public_reply', 'internal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE timer_kind AS ENUM (
    'level_respond', 'level_resolve', 'tenant_respond', 'tenant_resolve',
    'at_risk', 'hold_limit', 'auto_close', 'escalation_ack', 'busy_until'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outbox_kind AS ENUM ('notify', 'ai_enrich', 'report', 'import_row', 'timer_fire');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'done', 'failed', 'dead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'inactive', 'invited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lease_status AS ENUM ('Active', 'Ended', 'Pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chain_status AS ENUM ('draft', 'published', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE nobody_free_action AS ENUM ('unassign', 'escalate', 'notify_manager');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 1. Platform
-- ---------------------------------------------------------------------------
CREATE TABLE enterprises (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE licenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  plan          text NOT NULL,
  seats         int  NOT NULL CHECK (seats > 0),
  price_per_seat numeric(10,2) NOT NULL DEFAULT 0,
  starts_on     date NOT NULL DEFAULT CURRENT_DATE,
  expires_on    date NOT NULL,
  grace_days    int  NOT NULL DEFAULT 14,
  is_current    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX licenses_one_current
  ON licenses (enterprise_id) WHERE is_current;

CREATE TABLE enterprise_settings (
  enterprise_id            uuid PRIMARY KEY REFERENCES enterprises(id) ON DELETE CASCADE,
  ticket_prefix            text NOT NULL DEFAULT 'HD',
  auto_close_days          int  NOT NULL DEFAULT 7,
  reopen_window_days       int  NOT NULL DEFAULT 14,
  at_risk_pct              numeric(5,2) NOT NULL DEFAULT 25.00 CHECK (at_risk_pct > 0 AND at_risk_pct < 100),
  ai_wait_seconds          int  NOT NULL DEFAULT 30,
  ai_timeout_seconds       int  NOT NULL DEFAULT 45,
  ai_routing_mode          ai_routing_mode NOT NULL DEFAULT 'auto',
  ai_confidence_threshold  numeric(5,2) NOT NULL DEFAULT 85.00,
  ai_priority_raise_cap    int NOT NULL DEFAULT 1,
  negative_sentiment_threshold numeric(4,3) NOT NULL DEFAULT -0.350,
  negative_sentiment_cooldown_mins int NOT NULL DEFAULT 60,
  outbox_max_attempts      int NOT NULL DEFAULT 8
);

CREATE TABLE enterprise_counters (
  enterprise_id uuid PRIMARY KEY REFERENCES enterprises(id) ON DELETE CASCADE,
  next_ticket_n bigint NOT NULL DEFAULT 1 CHECK (next_ticket_n > 0)
);

-- ---------------------------------------------------------------------------
-- 2. Business hours
-- ---------------------------------------------------------------------------
CREATE TABLE business_calendars (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  name          text NOT NULL,
  timezone      text NOT NULL DEFAULT 'Europe/London',
  is_default    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (enterprise_id, id),
  UNIQUE (enterprise_id, name)
);

CREATE UNIQUE INDEX business_calendars_one_default
  ON business_calendars (enterprise_id) WHERE is_default;

CREATE TABLE business_hours (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  calendar_id   uuid NOT NULL,
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Mon .. 6=Sun
  opens_at      time NOT NULL,
  closes_at     time NOT NULL,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, calendar_id)
    REFERENCES business_calendars(enterprise_id, id) ON DELETE CASCADE,
  CHECK (closes_at > opens_at)
);

CREATE TABLE calendar_holidays (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  calendar_id   uuid NOT NULL,
  holiday_date  date NOT NULL,
  name          text,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, calendar_id)
    REFERENCES business_calendars(enterprise_id, id) ON DELETE CASCADE,
  UNIQUE (enterprise_id, calendar_id, holiday_date)
);

-- ---------------------------------------------------------------------------
-- 3. Portfolio
-- ---------------------------------------------------------------------------
CREATE TABLE regions (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  name          text NOT NULL,
  PRIMARY KEY (enterprise_id, id),
  UNIQUE (enterprise_id, name)
);

CREATE TABLE properties (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  region_id     uuid,
  name          text NOT NULL,
  timezone      text NOT NULL DEFAULT 'Europe/London',
  calendar_id   uuid,
  is_active     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (enterprise_id, id),
  UNIQUE (enterprise_id, name),
  FOREIGN KEY (enterprise_id, region_id)
    REFERENCES regions(enterprise_id, id),
  FOREIGN KEY (enterprise_id, calendar_id)
    REFERENCES business_calendars(enterprise_id, id)
);

CREATE TABLE units (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  property_id   uuid NOT NULL,
  code          text NOT NULL,
  floor         text,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, property_id)
    REFERENCES properties(enterprise_id, id) ON DELETE CASCADE,
  UNIQUE (enterprise_id, property_id, code)
);

CREATE TABLE assets (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  property_id   uuid NOT NULL,
  name          text NOT NULL,
  kind          asset_kind NOT NULL DEFAULT 'Asset',
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, property_id)
    REFERENCES properties(enterprise_id, id) ON DELETE CASCADE
);

CREATE TABLE tenants (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  email         text NOT NULL,
  phone         text,
  -- Sentiment SoT is ticket_comments / ai_predictions; these are denormalised cache only
  sentiment_label text,
  sentiment_score numeric(4,3),
  PRIMARY KEY (enterprise_id, id),
  UNIQUE (enterprise_id, email)
);

CREATE TABLE leases (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  tenant_id     uuid NOT NULL,
  unit_id       uuid NOT NULL,
  lease_ref     text NOT NULL,
  starts_on     date NOT NULL,
  ends_on       date,
  status        lease_status NOT NULL DEFAULT 'Active',
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, tenant_id)
    REFERENCES tenants(enterprise_id, id),
  FOREIGN KEY (enterprise_id, unit_id)
    REFERENCES units(enterprise_id, id),
  UNIQUE (enterprise_id, lease_ref)
);

-- ---------------------------------------------------------------------------
-- 4. People and access
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  description   text,
  rank          int  NOT NULL DEFAULT 0,
  is_system     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (enterprise_id, id),
  UNIQUE (enterprise_id, code)
);

CREATE TABLE role_permissions (
  enterprise_id uuid NOT NULL,
  role_id       uuid NOT NULL,
  permission    text NOT NULL,
  allowed       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (enterprise_id, role_id, permission),
  FOREIGN KEY (enterprise_id, role_id)
    REFERENCES roles(enterprise_id, id) ON DELETE CASCADE,
  CHECK (permission IN (
    'view','create','edit','delete','reassign','config','users','billing',
    'accept','decline','busy','respond','resolve'
  ))
);

CREATE TABLE users (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL,
  full_name     text NOT NULL,
  email         text NOT NULL,
  availability  availability_code NOT NULL DEFAULT 'Available',
  status        user_status NOT NULL DEFAULT 'active',
  open_ticket_count int NOT NULL DEFAULT 0 CHECK (open_ticket_count >= 0),
  last_assigned_at timestamptz,
  busy_until    timestamptz,
  unavailable_until timestamptz,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, role_id)
    REFERENCES roles(enterprise_id, id),
  UNIQUE (enterprise_id, email)
);

CREATE TABLE user_absences (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  user_id       uuid NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reason        text,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, user_id)
    REFERENCES users(enterprise_id, id) ON DELETE CASCADE,
  CHECK (ends_at > starts_at)
);

CREATE TABLE user_properties (
  enterprise_id uuid NOT NULL,
  user_id       uuid NOT NULL,
  property_id   uuid NOT NULL,
  PRIMARY KEY (enterprise_id, user_id, property_id),
  FOREIGN KEY (enterprise_id, user_id)
    REFERENCES users(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, property_id)
    REFERENCES properties(enterprise_id, id) ON DELETE CASCADE
);

CREATE TABLE user_region_scopes (
  enterprise_id uuid NOT NULL,
  user_id       uuid NOT NULL,
  region_id     uuid NOT NULL,
  PRIMARY KEY (enterprise_id, user_id, region_id),
  FOREIGN KEY (enterprise_id, user_id)
    REFERENCES users(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, region_id)
    REFERENCES regions(enterprise_id, id) ON DELETE CASCADE
);

-- user_skills references categories; created after categories table

-- ---------------------------------------------------------------------------
-- 5. Rules
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  parent_id     uuid,
  depth         category_depth NOT NULL,
  name          text NOT NULL,
  respond_mins  int CHECK (respond_mins IS NULL OR respond_mins > 0),
  resolve_mins  int CHECK (resolve_mins IS NULL OR resolve_mins > 0),
  is_active     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, parent_id)
    REFERENCES categories(enterprise_id, id),
  UNIQUE (enterprise_id, parent_id, name)
);

CREATE TABLE user_skills (
  enterprise_id uuid NOT NULL,
  user_id       uuid NOT NULL,
  category_id   uuid NOT NULL,
  PRIMARY KEY (enterprise_id, user_id, category_id),
  FOREIGN KEY (enterprise_id, user_id)
    REFERENCES users(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, category_id)
    REFERENCES categories(enterprise_id, id) ON DELETE CASCADE
);

CREATE TABLE sla_policies (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  category_id   uuid,
  name          text NOT NULL,
  respond_mins  int NOT NULL CHECK (respond_mins > 0),
  resolve_mins  int NOT NULL CHECK (resolve_mins > 0),
  is_default    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, category_id)
    REFERENCES categories(enterprise_id, id)
);

CREATE UNIQUE INDEX sla_policies_one_default
  ON sla_policies (enterprise_id) WHERE is_default;
CREATE UNIQUE INDEX sla_policies_category_uidx
  ON sla_policies (enterprise_id, category_id) WHERE category_id IS NOT NULL;

CREATE TABLE priority_rules (
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  priority      priority_code NOT NULL,
  multiplier    numeric(6,3) NOT NULL CHECK (multiplier > 0),
  runs_24_7     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (enterprise_id, priority)
);

CREATE TABLE escalation_chains (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  category_id   uuid,
  property_id   uuid,
  name          text NOT NULL,
  version       int  NOT NULL DEFAULT 1,
  status        chain_status NOT NULL DEFAULT 'draft',
  triggers      text[] NOT NULL DEFAULT ARRAY['sla_breach','ack_timeout','unassigned'],
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, category_id)
    REFERENCES categories(enterprise_id, id),
  FOREIGN KEY (enterprise_id, property_id)
    REFERENCES properties(enterprise_id, id)
);

CREATE TABLE escalation_levels (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  chain_id      uuid NOT NULL,
  level_no      int  NOT NULL CHECK (level_no >= 0),
  respond_mins  int,
  resolve_mins  int,
  ack_mins      int  NOT NULL DEFAULT 30 CHECK (ack_mins > 0),
  mode          escalation_mode NOT NULL DEFAULT 'sequential',
  workload_cap  int,
  nobody_free   nobody_free_action NOT NULL DEFAULT 'escalate',
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, chain_id)
    REFERENCES escalation_chains(enterprise_id, id) ON DELETE CASCADE,
  UNIQUE (enterprise_id, chain_id, level_no)
);

CREATE TABLE escalation_level_roles (
  enterprise_id uuid NOT NULL,
  level_id      uuid NOT NULL,
  role_id       uuid NOT NULL,
  PRIMARY KEY (enterprise_id, level_id, role_id),
  FOREIGN KEY (enterprise_id, level_id)
    REFERENCES escalation_levels(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, role_id)
    REFERENCES roles(enterprise_id, id)
);

CREATE TABLE escalation_severity_rules (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  chain_id      uuid NOT NULL,
  min_severity  text NOT NULL,
  skip_to_level int,
  notify_levels int[],
  window_factor numeric(6,3) NOT NULL DEFAULT 1.0,
  force_24_7    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, chain_id)
    REFERENCES escalation_chains(enterprise_id, id) ON DELETE CASCADE
);

CREATE TABLE routing_rules (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  property_id   uuid NOT NULL,
  category_id   uuid NOT NULL,
  preferred_user_id uuid,
  backup_user_id    uuid,
  manager_user_id   uuid,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, property_id)
    REFERENCES properties(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, category_id)
    REFERENCES categories(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, preferred_user_id)
    REFERENCES users(enterprise_id, id),
  FOREIGN KEY (enterprise_id, backup_user_id)
    REFERENCES users(enterprise_id, id),
  FOREIGN KEY (enterprise_id, manager_user_id)
    REFERENCES users(enterprise_id, id),
  UNIQUE (enterprise_id, property_id, category_id)
);

CREATE TABLE hold_reasons (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  code          text NOT NULL,
  label         text NOT NULL,
  waiting_on    text NOT NULL CHECK (waiting_on IN ('tenant', 'us')),
  limit_mins    int,
  pauses_tenant_sla boolean NOT NULL DEFAULT true,
  pauses_level_timers boolean NOT NULL DEFAULT false,
  PRIMARY KEY (enterprise_id, id),
  UNIQUE (enterprise_id, code)
);

-- ---------------------------------------------------------------------------
-- 6. Tickets
-- ---------------------------------------------------------------------------
CREATE TABLE tickets (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id   uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  ticket_number   text NOT NULL,
  property_id     uuid,
  unit_id         uuid,
  asset_id        uuid,
  tenant_id       uuid,
  lease_id        uuid,
  category_id     uuid,
  channel         text CHECK (channel IS NULL OR channel IN (
                    'Inbound call','Call','Email','Portal','Chat','Walk-in','Import','Other')),
  subject         text,
  priority        priority_code NOT NULL DEFAULT 'Normal',
  severity        text CHECK (severity IS NULL OR severity IN ('Critical','High','Medium','Low')),
  status          ticket_status NOT NULL DEFAULT 'Open',
  primary_user_id uuid,
  backup_user_id  uuid,
  manager_user_id uuid,
  current_level_no int NOT NULL DEFAULT 0,
  escalation_level int NOT NULL DEFAULT 0,
  escalation_state escalation_state NOT NULL DEFAULT 'none',
  needs_triage    boolean NOT NULL DEFAULT false,
  last_acked_by   uuid,
  last_ack_at     timestamptz,
  status_before_hold ticket_status,
  chain_id        uuid,
  clock_started_at timestamptz,
  tenant_respond_due timestamptz,
  tenant_resolve_due timestamptz,
  respond_breached_at timestamptz,
  resolve_breached_at timestamptz,
  hold_total_mins int NOT NULL DEFAULT 0,
  pause_total_mins int NOT NULL DEFAULT 0,
  first_response_at timestamptz,
  resolved_at     timestamptz,
  closed_at       timestamptz,
  rtat_mins       int,
  reopen_count    int NOT NULL DEFAULT 0,
  rating          smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  is_imported     boolean NOT NULL DEFAULT false,
  import_job_id   uuid,
  follow_up_of    uuid,
  ai_confidence   numeric(5,2),
  sentiment_label text,
  sentiment_score numeric(4,3),
  urgency_tags    text[] NOT NULL DEFAULT '{}',
  declined_user_ids uuid[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id),
  UNIQUE (enterprise_id, ticket_number),
  FOREIGN KEY (enterprise_id, property_id) REFERENCES properties(enterprise_id, id),
  FOREIGN KEY (enterprise_id, unit_id) REFERENCES units(enterprise_id, id),
  FOREIGN KEY (enterprise_id, asset_id) REFERENCES assets(enterprise_id, id),
  FOREIGN KEY (enterprise_id, tenant_id) REFERENCES tenants(enterprise_id, id),
  FOREIGN KEY (enterprise_id, lease_id) REFERENCES leases(enterprise_id, id),
  FOREIGN KEY (enterprise_id, category_id) REFERENCES categories(enterprise_id, id),
  FOREIGN KEY (enterprise_id, last_acked_by) REFERENCES users(enterprise_id, id),
  FOREIGN KEY (enterprise_id, primary_user_id) REFERENCES users(enterprise_id, id),
  FOREIGN KEY (enterprise_id, backup_user_id) REFERENCES users(enterprise_id, id),
  FOREIGN KEY (enterprise_id, manager_user_id) REFERENCES users(enterprise_id, id),
  FOREIGN KEY (enterprise_id, chain_id) REFERENCES escalation_chains(enterprise_id, id),
  FOREIGN KEY (enterprise_id, follow_up_of) REFERENCES tickets(enterprise_id, id)
);

CREATE INDEX tickets_status_idx ON tickets (enterprise_id, status);
CREATE INDEX tickets_primary_idx ON tickets (enterprise_id, primary_user_id) WHERE primary_user_id IS NOT NULL;

CREATE TABLE ticket_levels (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  level_no      int  NOT NULL,
  entered_at    timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz,
  respond_due   timestamptz,
  resolve_due   timestamptz,
  ack_due       timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, ticket_id)
    REFERENCES tickets(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, acknowledged_by)
    REFERENCES users(enterprise_id, id)
);

CREATE INDEX ticket_levels_open_idx
  ON ticket_levels (enterprise_id, ticket_id) WHERE left_at IS NULL;

CREATE TABLE ticket_assignments (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  ticket_level_id uuid,
  from_user_id  uuid,
  to_user_id    uuid,
  reason        assignment_reason NOT NULL,
  note          text,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  released_at   timestamptz,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, ticket_id)
    REFERENCES tickets(enterprise_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (enterprise_id, ticket_level_id)
    REFERENCES ticket_levels(enterprise_id, id),
  FOREIGN KEY (enterprise_id, from_user_id)
    REFERENCES users(enterprise_id, id),
  FOREIGN KEY (enterprise_id, to_user_id)
    REFERENCES users(enterprise_id, id)
);

CREATE INDEX ticket_assignments_ticket_idx
  ON ticket_assignments (enterprise_id, ticket_id, assigned_at);

CREATE TABLE ticket_holds (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  reason_id     uuid NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  pauses_tenant_sla boolean NOT NULL DEFAULT true,
  duration_mins int,
  started_by    uuid,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, ticket_id)
    REFERENCES tickets(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, reason_id)
    REFERENCES hold_reasons(enterprise_id, id),
  FOREIGN KEY (enterprise_id, started_by)
    REFERENCES users(enterprise_id, id)
);

/*
  ticket_timers — background worker contract (LLD §6)
  -------------------------------------------------
  In ONE transaction: claim due row (fires_at <= now(), consumed_at IS NULL,
  cancelled_at IS NULL) with FOR UPDATE SKIP LOCKED → re-check ticket state →
  act (idempotent; outbox dedupe_key includes timer_id) → set consumed_at.
  If obsolete, set cancelled_at instead of acting.
  State changes call cancel_timers() rather than leaving handlers to ignore rows.
  Poll every 5s; max lag < 30s so a 15m respond SLA stays useful.
*/
CREATE TABLE ticket_timers (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  ticket_id     uuid,
  user_id       uuid,
  kind          timer_kind NOT NULL,
  fires_at      timestamptz NOT NULL,
  consumed_at   timestamptz,
  cancelled_at  timestamptz,
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id, created_at),
  FOREIGN KEY (enterprise_id, ticket_id)
    REFERENCES tickets(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, user_id)
    REFERENCES users(enterprise_id, id) ON DELETE CASCADE
) PARTITION BY RANGE (created_at);

CREATE TABLE ticket_timers_default PARTITION OF ticket_timers DEFAULT;
CREATE TABLE ticket_timers_2026_10 PARTITION OF ticket_timers
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE ticket_timers_2026_11 PARTITION OF ticket_timers
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE ticket_timers_2026_12 PARTITION OF ticket_timers
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE ticket_timers_2027_01 PARTITION OF ticket_timers
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE INDEX ticket_timers_due_idx
  ON ticket_timers (fires_at)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE ticket_comments (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  author_user_id uuid,
  visibility    comment_visibility NOT NULL DEFAULT 'internal',
  body          text NOT NULL,
  sentiment_label text,
  sentiment_score numeric(4,3),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, ticket_id)
    REFERENCES tickets(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, author_user_id)
    REFERENCES users(enterprise_id, id),
  -- sentiment optional on tenant comments; constraint removed (was always-true OR true)
);

CREATE TABLE ticket_events (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  event_type    text NOT NULL,
  actor_user_id uuid,
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id, created_at),
  FOREIGN KEY (enterprise_id, ticket_id)
    REFERENCES tickets(enterprise_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (enterprise_id, actor_user_id)
    REFERENCES users(enterprise_id, id)
) PARTITION BY RANGE (created_at);

CREATE TABLE ticket_events_default PARTITION OF ticket_events DEFAULT;
CREATE TABLE ticket_events_2026_10 PARTITION OF ticket_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE ticket_events_2026_11 PARTITION OF ticket_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE ticket_events_2026_12 PARTITION OF ticket_events
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE ticket_events_2027_01 PARTITION OF ticket_events
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE INDEX ticket_events_ticket_idx
  ON ticket_events (enterprise_id, ticket_id, created_at);

CREATE TABLE notifications (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  ticket_id     uuid,
  channel       text NOT NULL CHECK (channel IN ('in_app', 'email')),
  title         text NOT NULL,
  body          text,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, user_id)
    REFERENCES users(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, ticket_id)
    REFERENCES tickets(enterprise_id, id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 7. AI, outbox, audit
-- ---------------------------------------------------------------------------
CREATE TABLE ai_predictions (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  ticket_id     uuid NOT NULL,
  category_id   uuid,
  sentiment_label text,
  sentiment_score numeric(4,3),
  severity      text,
  urgency_tags  text[] NOT NULL DEFAULT '{}',
  confidence    numeric(5,2),
  predicted_priority priority_code,
  routing_mode  ai_routing_mode NOT NULL DEFAULT 'auto',
  model_name    text,
  prompt_version text,
  needs_triage  boolean NOT NULL DEFAULT false,
  timed_out     boolean NOT NULL DEFAULT false,
  corrected_category_id uuid,
  corrected_priority priority_code,
  corrected_sentiment text,
  corrected_by  uuid,
  corrected_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, ticket_id)
    REFERENCES tickets(enterprise_id, id) ON DELETE CASCADE,
  FOREIGN KEY (enterprise_id, category_id)
    REFERENCES categories(enterprise_id, id),
  FOREIGN KEY (enterprise_id, corrected_category_id)
    REFERENCES categories(enterprise_id, id),
  FOREIGN KEY (enterprise_id, corrected_by)
    REFERENCES users(enterprise_id, id)
);

CREATE TABLE outbox_events (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  kind          outbox_kind NOT NULL,
  status        outbox_status NOT NULL DEFAULT 'pending',
  payload       jsonb NOT NULL DEFAULT '{}',
  dedupe_key    text,
  attempts      int NOT NULL DEFAULT 0,
  available_at  timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until  timestamptz,
  processed_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE outbox_events_default PARTITION OF outbox_events DEFAULT;
CREATE TABLE outbox_events_2026_10 PARTITION OF outbox_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE outbox_events_2026_11 PARTITION OF outbox_events
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE outbox_events_2026_12 PARTITION OF outbox_events
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE outbox_events_2027_01 PARTITION OF outbox_events
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

-- Dedupe unique includes partition key (created_at); app still uses stable dedupe_key values.
CREATE UNIQUE INDEX outbox_events_dedupe_uidx
  ON outbox_events (enterprise_id, dedupe_key, created_at)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX outbox_pending_idx
  ON outbox_events (next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE audit_log (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE RESTRICT,
  actor_user_id uuid,
  entity_type   text NOT NULL,
  entity_id     uuid,
  action        text NOT NULL,
  before_state  jsonb,
  after_state   jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
CREATE TABLE audit_log_2026_10 PARTITION OF audit_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_log_2026_11 PARTITION OF audit_log
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_log_2026_12 PARTITION OF audit_log
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_log_2027_01 PARTITION OF audit_log
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

-- ---------------------------------------------------------------------------
-- 8. Reports and migration
-- ---------------------------------------------------------------------------
CREATE TABLE report_runs (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  report_type   text NOT NULL,
  period_label  text,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid,
  formats       text[] NOT NULL DEFAULT ARRAY['PDF','XLSX'],
  storage_url   text,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, owner_user_id)
    REFERENCES users(enterprise_id, id)
);

CREATE TABLE import_jobs (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  status        text NOT NULL DEFAULT 'uploaded',
  rows_scanned  int NOT NULL DEFAULT 0,
  rows_valid    int NOT NULL DEFAULT 0,
  rows_warning  int NOT NULL DEFAULT 0,
  rows_error    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_id, id)
);

CREATE TABLE import_rows (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  enterprise_id uuid NOT NULL,
  job_id        uuid NOT NULL,
  row_number    int NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('ok','warning','error')),
  message       text,
  raw           jsonb,
  PRIMARY KEY (enterprise_id, id),
  FOREIGN KEY (enterprise_id, job_id)
    REFERENCES import_jobs(enterprise_id, id) ON DELETE CASCADE
);

ALTER TABLE tickets
  ADD CONSTRAINT tickets_import_job_fk
  FOREIGN KEY (enterprise_id, import_job_id)
  REFERENCES import_jobs(enterprise_id, id);

-- Guard: published chains referenced by tickets cannot be edited in place.
-- Application should clone+publish a new version; SQL trigger blocks UPDATE on published chains in use.
CREATE OR REPLACE FUNCTION prevent_edit_published_chain()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' AND EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.enterprise_id = OLD.enterprise_id AND t.chain_id = OLD.id
  ) AND (
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW.triggers IS DISTINCT FROM OLD.triggers
    OR NEW.category_id IS DISTINCT FROM OLD.category_id
    OR NEW.property_id IS DISTINCT FROM OLD.property_id
  ) THEN
    RAISE EXCEPTION 'published escalation chain % is in use and cannot be edited', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chain_immutable
  BEFORE UPDATE ON escalation_chains
  FOR EACH ROW EXECUTE FUNCTION prevent_edit_published_chain();

-- ---------------------------------------------------------------------------
-- 9. Reporting view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ticket_facts AS
SELECT
  t.enterprise_id,
  t.id AS ticket_id,
  t.ticket_number,
  t.status,
  t.priority,
  date_trunc('month', COALESCE(t.closed_at, t.resolved_at, t.created_at)) AS month_bucket,
  t.closed_at::date AS close_date,
  t.rtat_mins,
  CASE
    WHEN t.clock_started_at IS NOT NULL AND t.resolved_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (t.resolved_at - t.clock_started_at)) / 60.0
    ELSE NULL
  END AS elapsed_wall_mins,
  CASE
    WHEN t.rtat_mins IS NOT NULL
      AND t.clock_started_at IS NOT NULL
      AND t.resolved_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (t.resolved_at - t.clock_started_at)) > 0
      THEN t.rtat_mins::numeric
           / (EXTRACT(EPOCH FROM (t.resolved_at - t.clock_started_at)) / 60.0)
    ELSE NULL
  END AS rtat_ett_ratio,
  (
    SELECT COUNT(*)::int
    FROM ticket_levels tl
    WHERE tl.enterprise_id = t.enterprise_id
      AND tl.ticket_id = t.id
      AND tl.level_no > 0
  ) AS escalation_step_count,
  t.category_id,
  t.property_id,
  t.primary_user_id
FROM tickets t;

-- ---------------------------------------------------------------------------
-- Engine helpers
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tenancy assert + timer claim (RLS session: SET LOCAL app.enterprise_id)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_enterprise_id()
RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid;
BEGIN
  BEGIN
    v := nullif(current_setting('app.enterprise_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v := NULL;
  END;
  IF v IS NULL THEN
    RAISE EXCEPTION 'TENANT_CONTEXT: app.enterprise_id is not set'
      USING ERRCODE = '42501';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION assert_enterprise(p_enterprise_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid := current_enterprise_id();
BEGIN
  IF p_enterprise_id IS DISTINCT FROM v THEN
    RAISE EXCEPTION 'TENANT_ISOLATION: function enterprise % != session %', p_enterprise_id, v
      USING ERRCODE = '42501';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION claim_due_timer(p_enterprise_id uuid)
RETURNS ticket_timers
LANGUAGE plpgsql AS $$
DECLARE r ticket_timers;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO r FROM ticket_timers
  WHERE enterprise_id = p_enterprise_id
    AND consumed_at IS NULL
    AND cancelled_at IS NULL
    AND fires_at <= now()
  ORDER BY fires_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION consume_timer(p_enterprise_id uuid, p_timer_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  UPDATE ticket_timers SET consumed_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_timer_id
    AND consumed_at IS NULL AND cancelled_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_outbox(
  p_enterprise_id uuid,
  p_kind outbox_kind,
  p_payload jsonb DEFAULT '{}',
  p_dedupe_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  IF p_dedupe_key IS NULL THEN
    INSERT INTO outbox_events (enterprise_id, kind, payload)
    VALUES (p_enterprise_id, p_kind, p_payload)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  INSERT INTO outbox_events (enterprise_id, kind, payload, dedupe_key)
  VALUES (p_enterprise_id, p_kind, p_payload, p_dedupe_key)
  ON CONFLICT (enterprise_id, dedupe_key)
  DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM outbox_events
    WHERE enterprise_id = p_enterprise_id AND dedupe_key = p_dedupe_key;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION record_event(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_event_type text,
  p_actor uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
  v_key text;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  INSERT INTO ticket_events (enterprise_id, ticket_id, event_type, actor_user_id, payload)
  VALUES (p_enterprise_id, p_ticket_id, p_event_type, p_actor, p_payload)
  RETURNING id INTO v_id;
  v_key := 'notify:' || p_ticket_id::text || ':' || p_event_type || ':' || v_id::text;
  PERFORM enqueue_outbox(p_enterprise_id, 'notify', jsonb_build_object(
    'ticket_id', p_ticket_id, 'event_type', p_event_type, 'event_id', v_id
  ), v_key);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION next_ticket_number(p_enterprise_id uuid)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_n bigint;
  v_prefix text;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);

  INSERT INTO enterprise_counters (enterprise_id, next_ticket_n)
  VALUES (p_enterprise_id, 2)
  ON CONFLICT (enterprise_id) DO UPDATE
    SET next_ticket_n = enterprise_counters.next_ticket_n + 1
  RETURNING next_ticket_n - 1 INTO v_n;

  SELECT ticket_prefix INTO v_prefix
  FROM enterprise_settings WHERE enterprise_id = p_enterprise_id;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'enterprise_settings missing for %', p_enterprise_id;
  END IF;

  RETURN v_prefix || '-' || lpad(v_n::text, GREATEST(5, length(v_n::text)), '0');
END;
$$;

CREATE OR REPLACE FUNCTION resolve_sla_policy(
  p_enterprise_id uuid,
  p_category_id uuid
) RETURNS sla_policies
LANGUAGE plpgsql STABLE AS $$
DECLARE v sla_policies;
BEGIN
  SELECT * INTO v FROM sla_policies
  WHERE enterprise_id = p_enterprise_id AND category_id = p_category_id
  LIMIT 1;
  IF FOUND THEN RETURN v; END IF;

  SELECT * INTO v FROM sla_policies
  WHERE enterprise_id = p_enterprise_id AND is_default
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no SLA policy for enterprise %', p_enterprise_id;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_chain(
  p_enterprise_id uuid,
  p_category_id uuid,
  p_property_id uuid
) RETURNS escalation_chains
LANGUAGE plpgsql STABLE AS $$
DECLARE v escalation_chains;
BEGIN
  IF p_property_id IS NOT NULL THEN
    SELECT * INTO v FROM escalation_chains
    WHERE enterprise_id = p_enterprise_id
      AND status = 'published'
      AND category_id = p_category_id
      AND property_id = p_property_id
    ORDER BY version DESC LIMIT 1;
    IF FOUND THEN RETURN v; END IF;
  END IF;

  SELECT * INTO v FROM escalation_chains
  WHERE enterprise_id = p_enterprise_id
    AND status = 'published'
    AND category_id = p_category_id
    AND property_id IS NULL
  ORDER BY version DESC LIMIT 1;
  IF FOUND THEN RETURN v; END IF;

  SELECT * INTO v FROM escalation_chains
  WHERE enterprise_id = p_enterprise_id
    AND status = 'published'
    AND category_id IS NULL
    AND property_id IS NULL
  ORDER BY version DESC LIMIT 1;
  RETURN v;
END;
$$;

-- Business-minute helpers (calendar timezone + DST; capped; fail if no hours).
CREATE OR REPLACE FUNCTION add_business_minutes(
  p_enterprise_id uuid,
  p_calendar_id uuid,
  p_from timestamptz,
  p_mins int
) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_left int := p_mins;
  v_cursor timestamptz := p_from;
  v_tz text;
  v_day date;
  v_wd smallint;
  v_open time;
  v_close time;
  v_seg_start timestamptz;
  v_seg_end timestamptz;
  v_avail int;
  v_iters int := 0;
  v_has_hours boolean;
BEGIN
  IF p_mins IS NULL OR p_mins <= 0 THEN RETURN p_from; END IF;
  IF p_calendar_id IS NULL THEN
    RETURN p_from + make_interval(mins => p_mins);
  END IF;

  SELECT timezone INTO v_tz FROM business_calendars
  WHERE enterprise_id = p_enterprise_id AND id = p_calendar_id;
  v_tz := COALESCE(v_tz, 'UTC');

  SELECT EXISTS (
    SELECT 1 FROM business_hours bh
    WHERE bh.enterprise_id = p_enterprise_id AND bh.calendar_id = p_calendar_id
  ) INTO v_has_hours;
  IF NOT v_has_hours THEN
    RAISE EXCEPTION 'calendar % has no business_hours rows', p_calendar_id;
  END IF;

  WHILE v_left > 0 LOOP
    v_iters := v_iters + 1;
    IF v_iters > 366 THEN
      RAISE EXCEPTION 'add_business_minutes exceeded 366 day iterations';
    END IF;

    v_day := (v_cursor AT TIME ZONE v_tz)::date;
    v_wd := EXTRACT(ISODOW FROM v_day)::smallint - 1;

    IF EXISTS (
      SELECT 1 FROM calendar_holidays h
      WHERE h.enterprise_id = p_enterprise_id
        AND h.calendar_id = p_calendar_id
        AND h.holiday_date = v_day
    ) THEN
      v_cursor := ((v_day + 1)::timestamp AT TIME ZONE v_tz);
      CONTINUE;
    END IF;

    -- Support split shifts: consume earliest window still open at cursor
    SELECT bh.opens_at, bh.closes_at INTO v_open, v_close
    FROM business_hours bh
    WHERE bh.enterprise_id = p_enterprise_id
      AND bh.calendar_id = p_calendar_id
      AND bh.weekday = v_wd
      AND (v_day + bh.closes_at) AT TIME ZONE v_tz > v_cursor
    ORDER BY bh.opens_at
    LIMIT 1;

    IF v_open IS NULL THEN
      v_cursor := ((v_day + 1)::timestamp AT TIME ZONE v_tz);
      CONTINUE;
    END IF;

    v_seg_start := (v_day + v_open) AT TIME ZONE v_tz;
    v_seg_end   := (v_day + v_close) AT TIME ZONE v_tz;
    IF v_cursor < v_seg_start THEN v_cursor := v_seg_start; END IF;
    IF v_cursor >= v_seg_end THEN
      v_cursor := ((v_day + 1)::timestamp AT TIME ZONE v_tz);
      CONTINUE;
    END IF;

    v_avail := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_seg_end - v_cursor)) / 60.0)::int);
    IF v_avail >= v_left THEN
      RETURN v_cursor + make_interval(mins => v_left);
    END IF;
    v_left := v_left - v_avail;
    v_cursor := v_seg_end;
  END LOOP;
  RETURN v_cursor;
END;
$$;

CREATE OR REPLACE FUNCTION business_minutes_between(
  p_enterprise_id uuid,
  p_calendar_id uuid,
  p_from timestamptz,
  p_to timestamptz
) RETURNS int
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total int := 0;
  v_cursor timestamptz := p_from;
  v_tz text;
  v_day date;
  v_wd smallint;
  v_open time;
  v_close time;
  v_seg_start timestamptz;
  v_seg_end timestamptz;
  v_a timestamptz;
  v_b timestamptz;
  v_iters int := 0;
  r record;
BEGIN
  IF p_to <= p_from THEN RETURN 0; END IF;
  IF p_calendar_id IS NULL THEN
    RETURN FLOOR(EXTRACT(EPOCH FROM (p_to - p_from)) / 60.0)::int;
  END IF;

  SELECT timezone INTO v_tz FROM business_calendars
  WHERE enterprise_id = p_enterprise_id AND id = p_calendar_id;
  v_tz := COALESCE(v_tz, 'UTC');

  IF NOT EXISTS (
    SELECT 1 FROM business_hours bh
    WHERE bh.enterprise_id = p_enterprise_id AND bh.calendar_id = p_calendar_id
  ) THEN
    RAISE EXCEPTION 'calendar % has no business_hours rows', p_calendar_id;
  END IF;

  WHILE v_cursor < p_to LOOP
    v_iters := v_iters + 1;
    IF v_iters > 366 THEN
      RAISE EXCEPTION 'business_minutes_between exceeded 366 day iterations';
    END IF;

    v_day := (v_cursor AT TIME ZONE v_tz)::date;
    v_wd := EXTRACT(ISODOW FROM v_day)::smallint - 1;

    IF EXISTS (
      SELECT 1 FROM calendar_holidays h
      WHERE h.enterprise_id = p_enterprise_id
        AND h.calendar_id = p_calendar_id
        AND h.holiday_date = v_day
    ) THEN
      v_cursor := ((v_day + 1)::timestamp AT TIME ZONE v_tz);
      CONTINUE;
    END IF;

    FOR r IN
      SELECT bh.opens_at, bh.closes_at
      FROM business_hours bh
      WHERE bh.enterprise_id = p_enterprise_id
        AND bh.calendar_id = p_calendar_id
        AND bh.weekday = v_wd
      ORDER BY bh.opens_at
    LOOP
      v_seg_start := (v_day + r.opens_at) AT TIME ZONE v_tz;
      v_seg_end   := (v_day + r.closes_at) AT TIME ZONE v_tz;
      v_a := GREATEST(v_cursor, v_seg_start);
      v_b := LEAST(p_to, v_seg_end);
      IF v_b > v_a THEN
        v_total := v_total + FLOOR(EXTRACT(EPOCH FROM (v_b - v_a)) / 60.0)::int;
      END IF;
    END LOOP;
    v_cursor := ((v_day + 1)::timestamp AT TIME ZONE v_tz);
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION clear_open_timers(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_kinds timer_kind[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  UPDATE ticket_timers
  SET cancelled_at = COALESCE(cancelled_at, now())
  WHERE enterprise_id = p_enterprise_id
    AND ticket_id = p_ticket_id
    AND consumed_at IS NULL
    AND cancelled_at IS NULL
    AND (p_kinds IS NULL OR kind = ANY (p_kinds));
END;
$$;

CREATE OR REPLACE FUNCTION arm_timer(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_kind timer_kind,
  p_fires_at timestamptz,
  p_payload jsonb DEFAULT '{}',
  p_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  IF p_fires_at IS NULL THEN RETURN NULL; END IF;
  INSERT INTO ticket_timers (enterprise_id, ticket_id, user_id, kind, fires_at, payload)
  VALUES (
    p_enterprise_id, p_ticket_id,
    COALESCE(p_user_id, (p_payload->>'user_id')::uuid),
    p_kind, p_fires_at, p_payload
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION apply_ticket_policy(
  p_enterprise_id uuid,
  p_ticket_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  pol sla_policies%ROWTYPE;
  pr priority_rules%ROWTYPE;
  cat categories%ROWTYPE;
  prop properties%ROWTYPE;
  respond int;
  resolve int;
  start_at timestamptz;
  at_risk_pct numeric;
  window_mins int;
  at_risk_at timestamptz;
  cal uuid;
BEGIN
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  -- Closed historical imports skip clocks; open imports apply SLA from import/now
  IF t.is_imported AND t.status IN ('Resolved', 'Closed') THEN RETURN; END IF;

  pol := resolve_sla_policy(p_enterprise_id, t.category_id);

  SELECT * INTO cat FROM categories
  WHERE enterprise_id = p_enterprise_id AND id = t.category_id;

  respond := COALESCE(cat.respond_mins, pol.respond_mins);
  resolve := COALESCE(cat.resolve_mins, pol.resolve_mins);

  SELECT * INTO pr FROM priority_rules
  WHERE enterprise_id = p_enterprise_id AND priority = t.priority;
  IF FOUND THEN
    respond := CEIL(respond * pr.multiplier)::int;
    resolve := CEIL(resolve * pr.multiplier)::int;
  END IF;

  SELECT * INTO prop FROM properties
  WHERE enterprise_id = p_enterprise_id AND id = t.property_id;
  cal := prop.calendar_id;

  start_at := COALESCE(t.clock_started_at, now());
  IF t.clock_started_at IS NULL THEN
    UPDATE tickets SET clock_started_at = start_at, updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
  END IF;

  SELECT s.at_risk_pct INTO at_risk_pct
  FROM enterprise_settings s WHERE s.enterprise_id = p_enterprise_id;
  at_risk_pct := COALESCE(at_risk_pct, 25);

  IF pr.runs_24_7 OR cal IS NULL THEN
    UPDATE tickets SET
      tenant_respond_due = start_at + make_interval(mins => respond) + make_interval(mins => COALESCE(t.pause_total_mins, 0)),
      tenant_resolve_due = start_at + make_interval(mins => resolve) + make_interval(mins => COALESCE(t.pause_total_mins, 0)),
      updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id
    RETURNING * INTO t;
  ELSE
    UPDATE tickets SET
      tenant_respond_due = add_business_minutes(p_enterprise_id, cal, start_at, respond + COALESCE(t.pause_total_mins, 0)),
      tenant_resolve_due = add_business_minutes(p_enterprise_id, cal, start_at, resolve + COALESCE(t.pause_total_mins, 0)),
      updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id
    RETURNING * INTO t;
  END IF;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
    ARRAY['tenant_respond','tenant_resolve','at_risk']::timer_kind[]);

  PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'tenant_respond', t.tenant_respond_due);
  PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'tenant_resolve', t.tenant_resolve_due);

  window_mins := respond;
  at_risk_at := t.tenant_respond_due - make_interval(mins => GREATEST(1, FLOOR(window_mins * at_risk_pct / 100.0)::int));
  IF at_risk_at > now() THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'at_risk', at_risk_at);
  END IF;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'policy_applied', NULL,
    jsonb_build_object('respond_mins', respond, 'resolve_mins', resolve));
END;
$$;

CREATE OR REPLACE FUNCTION enter_level(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_level_no int
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  lvl escalation_levels%ROWTYPE;
  v_id uuid;
  v_ack timestamptz;
BEGIN
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  UPDATE ticket_levels SET left_at = now()
  WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND left_at IS NULL;

  IF t.chain_id IS NOT NULL THEN
    SELECT * INTO lvl FROM escalation_levels
    WHERE enterprise_id = p_enterprise_id AND chain_id = t.chain_id AND level_no = p_level_no;
  END IF;

  v_ack := CASE WHEN lvl.ack_mins IS NOT NULL
    THEN now() + make_interval(mins => lvl.ack_mins) ELSE NULL END;

  INSERT INTO ticket_levels (
    enterprise_id, ticket_id, level_no, respond_due, resolve_due, ack_due
  ) VALUES (
    p_enterprise_id, p_ticket_id, p_level_no,
    CASE WHEN lvl.respond_mins IS NOT NULL THEN now() + make_interval(mins => lvl.respond_mins) END,
    CASE WHEN lvl.resolve_mins IS NOT NULL THEN now() + make_interval(mins => lvl.resolve_mins) END,
    v_ack
  ) RETURNING id INTO v_id;

  UPDATE tickets SET current_level_no = p_level_no, updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
    ARRAY['level_respond','level_resolve','escalation_ack']::timer_kind[]);

  IF lvl.respond_mins IS NOT NULL THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'level_respond',
      now() + make_interval(mins => lvl.respond_mins));
  END IF;
  IF lvl.resolve_mins IS NOT NULL THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'level_resolve',
      now() + make_interval(mins => lvl.resolve_mins));
  END IF;
  IF v_ack IS NOT NULL AND p_level_no > 0 THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'escalation_ack', v_ack);
  END IF;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'enter_level', NULL,
    jsonb_build_object('level_no', p_level_no));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION assign_level(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_to_user_id uuid,
  p_reason assignment_reason,
  p_from_user_id uuid DEFAULT NULL,
  p_backup_user_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  lvl_id uuid;
  v_id uuid;
BEGIN
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  SELECT id INTO lvl_id FROM ticket_levels
  WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND left_at IS NULL
  ORDER BY entered_at DESC LIMIT 1;

  -- Release previous open assignment
  UPDATE ticket_assignments SET released_at = now()
  WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND released_at IS NULL;

  INSERT INTO ticket_assignments (
    enterprise_id, ticket_id, ticket_level_id, from_user_id, to_user_id, reason, note
  ) VALUES (
    p_enterprise_id, p_ticket_id, lvl_id,
    COALESCE(p_from_user_id, t.primary_user_id),
    p_to_user_id, p_reason, p_note
  ) RETURNING id INTO v_id;

  UPDATE tickets SET
    primary_user_id = p_to_user_id,
    backup_user_id = COALESCE(p_backup_user_id, backup_user_id),
    status = CASE
      WHEN p_to_user_id IS NULL THEN 'Unassigned'::ticket_status
      WHEN status = 'Unassigned' THEN 'Open'::ticket_status
      ELSE status
    END,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  IF t.primary_user_id IS NOT NULL AND t.primary_user_id IS DISTINCT FROM p_to_user_id THEN
    UPDATE users SET open_ticket_count = GREATEST(0, open_ticket_count - 1)
    WHERE enterprise_id = p_enterprise_id AND id = t.primary_user_id;
  END IF;
  IF p_to_user_id IS NOT NULL AND t.primary_user_id IS DISTINCT FROM p_to_user_id THEN
    UPDATE users SET last_assigned_at = now(), open_ticket_count = open_ticket_count + 1
    WHERE enterprise_id = p_enterprise_id AND id = p_to_user_id;
  ELSIF p_to_user_id IS NOT NULL THEN
    UPDATE users SET last_assigned_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_to_user_id;
  END IF;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'assignment', NULL,
    jsonb_build_object('to', p_to_user_id, 'reason', p_reason));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION pick_and_assign(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_reason assignment_reason DEFAULT 'initial_route'
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  rr routing_rules%ROWTYPE;
  primary_id uuid;
  backup_id uuid;
  from_id uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;
  from_id := t.primary_user_id;

  -- Serialize skill-pool selection (concurrency)
  PERFORM pg_advisory_xact_lock(hashtext(p_enterprise_id::text || ':' || COALESCE(t.category_id::text, '')));

  -- Prefer explicit routing rule
  SELECT * INTO rr FROM routing_rules
  WHERE enterprise_id = p_enterprise_id
    AND property_id = t.property_id
    AND category_id = t.category_id;

  IF FOUND AND rr.preferred_user_id IS NOT NULL
     AND NOT (rr.preferred_user_id = ANY (t.declined_user_ids))
     AND EXISTS (
       SELECT 1 FROM users u
       WHERE u.enterprise_id = p_enterprise_id AND u.id = rr.preferred_user_id
         AND u.status = 'active'
         AND u.availability IN ('Available', 'On call')
     ) THEN
    primary_id := rr.preferred_user_id;
    backup_id := rr.backup_user_id;
    IF rr.manager_user_id IS NOT NULL THEN
      UPDATE tickets SET manager_user_id = rr.manager_user_id
      WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    END IF;
  ELSE
    SELECT u.id INTO primary_id
    FROM users u
    JOIN user_skills us ON us.enterprise_id = u.enterprise_id AND us.user_id = u.id
    WHERE u.enterprise_id = p_enterprise_id
      AND us.category_id = t.category_id
      AND u.status = 'active'
      AND u.availability IN ('Available', 'On call')
      AND (u.busy_until IS NULL OR u.busy_until <= now())
      AND NOT (u.id = ANY (t.declined_user_ids))
      AND (
        NOT EXISTS (
          SELECT 1 FROM user_properties up
          WHERE up.enterprise_id = u.enterprise_id AND up.user_id = u.id
        )
        OR EXISTS (
          SELECT 1 FROM user_properties up
          WHERE up.enterprise_id = u.enterprise_id AND up.user_id = u.id
            AND up.property_id = t.property_id
        )
      )
    ORDER BY u.open_ticket_count ASC, u.last_assigned_at ASC NULLS FIRST
    FOR UPDATE OF u SKIP LOCKED
    LIMIT 1;

    IF primary_id IS NOT NULL THEN
      SELECT u.id INTO backup_id
      FROM users u
      JOIN user_skills us ON us.enterprise_id = u.enterprise_id AND us.user_id = u.id
      WHERE u.enterprise_id = p_enterprise_id
        AND us.category_id = t.category_id
        AND u.status = 'active'
        AND u.availability IN ('Available', 'On call')
        AND u.id <> primary_id
        AND NOT (u.id = ANY (t.declined_user_ids))
      ORDER BY u.open_ticket_count ASC, u.last_assigned_at ASC NULLS FIRST
      LIMIT 1;
    END IF;
  END IF;

  RETURN assign_level(
    p_enterprise_id, p_ticket_id, primary_id, p_reason, from_id, backup_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION respond_to_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t tickets%ROWTYPE;
BEGIN
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.primary_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only primary can accept/respond';
  END IF;
  IF t.status IN ('Unassigned', 'Resolved', 'Closed', 'Cancelled', 'Duplicate') THEN
    RAISE EXCEPTION 'cannot respond from status %', t.status;
  END IF;
  IF t.escalation_state = 'waiting' THEN
    RAISE EXCEPTION 'ESCALATION_OPEN: respond blocked while escalation waiting';
  END IF;

  UPDATE tickets SET
    status = 'In Progress',
    first_response_at = COALESCE(first_response_at, now()),
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
    ARRAY['tenant_respond','level_respond']::timer_kind[]);
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'responded', p_user_id, '{}');
END;
$$;

CREATE OR REPLACE FUNCTION start_hold(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_reason_id uuid,
  p_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  hr hold_reasons%ROWTYPE;
  v_id uuid;
  pauses boolean;
BEGIN
  SELECT * INTO hr FROM hold_reasons
  WHERE enterprise_id = p_enterprise_id AND id = p_reason_id;
  pauses := COALESCE(hr.pauses_tenant_sla, true);

  INSERT INTO ticket_holds (
    enterprise_id, ticket_id, reason_id, pauses_tenant_sla, started_by
  ) VALUES (
    p_enterprise_id, p_ticket_id, p_reason_id, pauses, p_user_id
  ) RETURNING id INTO v_id;

  UPDATE tickets SET status = 'On Hold', updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  IF hr.limit_mins IS NOT NULL THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'hold_limit',
      now() + make_interval(mins => hr.limit_mins),
      jsonb_build_object('hold_id', v_id));
  END IF;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'hold_started', p_user_id,
    jsonb_build_object('hold_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION end_hold(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_hold_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  h ticket_holds%ROWTYPE;
  dur int;
BEGIN
  SELECT * INTO h FROM ticket_holds
  WHERE enterprise_id = p_enterprise_id
    AND ticket_id = p_ticket_id
    AND ended_at IS NULL
    AND (p_hold_id IS NULL OR id = p_hold_id)
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'no open hold'; END IF;

  dur := FLOOR(EXTRACT(EPOCH FROM (now() - h.started_at)) / 60.0)::int;
  UPDATE ticket_holds SET ended_at = now(), duration_mins = dur
  WHERE enterprise_id = p_enterprise_id AND id = h.id;

  UPDATE tickets SET
    status = 'In Progress',
    hold_total_mins = hold_total_mins + dur,
    pause_total_mins = pause_total_mins + CASE WHEN h.pauses_tenant_sla THEN dur ELSE 0 END,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, ARRAY['hold_limit']::timer_kind[]);
  IF h.pauses_tenant_sla THEN
    PERFORM apply_ticket_policy(p_enterprise_id, p_ticket_id);
  END IF;
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'hold_ended', NULL,
    jsonb_build_object('hold_id', h.id, 'duration_mins', dur));
END;
$$;

CREATE OR REPLACE FUNCTION escalate_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid
) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  next_level int;
  max_level int;
BEGIN
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.chain_id IS NULL THEN
    RAISE EXCEPTION 'ticket has no escalation chain';
  END IF;

  SELECT COALESCE(MAX(level_no), 0) INTO max_level
  FROM escalation_levels
  WHERE enterprise_id = p_enterprise_id AND chain_id = t.chain_id;

  next_level := LEAST(t.current_level_no + 1, max_level);

  UPDATE tickets SET
    escalation_level = next_level,
    escalation_state = 'waiting',
    current_level_no = next_level,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM enter_level(p_enterprise_id, p_ticket_id, next_level);
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'escalated', NULL,
    jsonb_build_object('level_no', next_level));
  -- Never changes work status to Resolved
  RETURN next_level;
END;
$$;

CREATE OR REPLACE FUNCTION acknowledge_escalation(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ticket_levels SET
    acknowledged_at = now(),
    acknowledged_by = p_user_id,
    left_at = now()
  WHERE enterprise_id = p_enterprise_id
    AND ticket_id = p_ticket_id
    AND left_at IS NULL;

  UPDATE tickets SET
    escalation_state = 'acked',
    escalation_level = 0,
    current_level_no = 0,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  -- Anti-loop marker in events
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'escalation_acked', p_user_id,
    jsonb_build_object('anti_loop', true));

  UPDATE tickets SET escalation_state = 'none', updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM enter_level(p_enterprise_id, p_ticket_id, 0);
  PERFORM pick_and_assign(p_enterprise_id, p_ticket_id, 'escalate_ack');
END;
$$;

CREATE OR REPLACE FUNCTION resolve_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  prop properties%ROWTYPE;
  cal uuid;
BEGIN
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.escalation_state = 'waiting' THEN
    RAISE EXCEPTION 'ESCALATION_OPEN: cannot resolve while escalation waiting';
  END IF;
  IF t.primary_user_id IS NULL OR t.status = 'Unassigned' THEN
    RAISE EXCEPTION 'cannot resolve without primary assignee';
  END IF;
  IF t.status IN ('Resolved', 'Closed') THEN
    RAISE EXCEPTION 'already resolved/closed';
  END IF;

  SELECT calendar_id INTO cal FROM properties
  WHERE enterprise_id = p_enterprise_id AND id = t.property_id;

  UPDATE tickets SET
    status = 'Resolved',
    resolved_at = now(),
    rtat_mins = CASE
      WHEN clock_started_at IS NOT NULL THEN
        business_minutes_between(p_enterprise_id, cal, clock_started_at, now())
          - pause_total_mins
      ELSE NULL
    END,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  IF t.primary_user_id IS NOT NULL THEN
    UPDATE users SET open_ticket_count = GREATEST(0, open_ticket_count - 1)
    WHERE enterprise_id = p_enterprise_id AND id = t.primary_user_id;
  END IF;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, NULL);

  PERFORM arm_timer(
    p_enterprise_id, p_ticket_id, 'auto_close',
    now() + (
      SELECT make_interval(days => s.auto_close_days)
      FROM enterprise_settings s WHERE s.enterprise_id = p_enterprise_id
    )
  );

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'resolved', p_user_id, '{}');
END;
$$;

CREATE OR REPLACE FUNCTION reopen_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  days int;
  new_id uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.status = 'Resolved' THEN
    UPDATE tickets SET
      status = 'In Progress',
      resolved_at = NULL,
      closed_at = NULL,
      reopen_count = reopen_count + 1,
      clock_started_at = now(),
      updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, ARRAY['auto_close']::timer_kind[]);
    PERFORM apply_ticket_policy(p_enterprise_id, p_ticket_id);
    PERFORM record_event(p_enterprise_id, p_ticket_id, 'reopened', p_user_id, '{}');
    RETURN p_ticket_id;
  END IF;

  IF t.status <> 'Closed' THEN
    RAISE EXCEPTION 'ticket not reopenable';
  END IF;

  SELECT reopen_window_days INTO days FROM enterprise_settings WHERE enterprise_id = p_enterprise_id;
  IF t.closed_at IS NOT NULL AND t.closed_at + make_interval(days => COALESCE(days, 14)) >= now() THEN
    UPDATE tickets SET
      status = 'In Progress',
      resolved_at = NULL,
      closed_at = NULL,
      reopen_count = reopen_count + 1,
      clock_started_at = now(),
      updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    PERFORM apply_ticket_policy(p_enterprise_id, p_ticket_id);
    PERFORM record_event(p_enterprise_id, p_ticket_id, 'reopened', p_user_id, '{}');
    RETURN p_ticket_id;
  END IF;

  -- Window expired → new linked ticket
  INSERT INTO tickets (
    enterprise_id, ticket_number, property_id, unit_id, tenant_id, lease_id,
    category_id, channel, subject, priority, status, chain_id, follow_up_of,
    clock_started_at
  ) VALUES (
    p_enterprise_id, next_ticket_number(p_enterprise_id),
    t.property_id, t.unit_id, t.tenant_id, t.lease_id,
    t.category_id, t.channel, t.subject, t.priority, 'Open', t.chain_id, t.id,
    now()
  ) RETURNING id INTO new_id;
  PERFORM apply_ticket_policy(p_enterprise_id, new_id);
  PERFORM record_event(p_enterprise_id, new_id, 'follow_up_created', p_user_id,
    jsonb_build_object('from', p_ticket_id));
  RAISE EXCEPTION 'REOPEN_EXPIRED: created follow-up %', new_id;
END;
$$;

CREATE OR REPLACE FUNCTION close_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t tickets%ROWTYPE;
BEGIN
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.status <> 'Resolved' THEN
    RAISE EXCEPTION 'only resolved tickets can close';
  END IF;

  UPDATE tickets SET status = 'Closed', closed_at = now(), updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, NULL);
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'closed', NULL, '{}');
END;
$$;

-- Decline / busy helpers used by API / Walkthrough parity
CREATE OR REPLACE FUNCTION decline_assignment(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE t tickets%ROWTYPE;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.status = 'In Progress' THEN
    RAISE EXCEPTION 'HANDOFF_FROZEN: handoff frozen after accept; escalate or reassign';
  END IF;
  IF t.primary_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only primary can decline';
  END IF;

  UPDATE tickets SET
    declined_user_ids = array_append(declined_user_ids, p_user_id),
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  RETURN pick_and_assign(p_enterprise_id, p_ticket_id, 'declined');
END;
$$;

CREATE OR REPLACE FUNCTION mark_assignee_busy(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid,
  p_busy_mins int DEFAULT 60
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  until_ts timestamptz;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.status = 'In Progress' THEN
    RAISE EXCEPTION 'HANDOFF_FROZEN: handoff frozen after accept; escalate or reassign';
  END IF;
  IF t.primary_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only primary can mark busy';
  END IF;

  until_ts := now() + make_interval(mins => GREATEST(1, COALESCE(p_busy_mins, 60)));

  UPDATE users SET availability = 'Unavailable', busy_until = until_ts, unavailable_until = until_ts
  WHERE enterprise_id = p_enterprise_id AND id = p_user_id;

  INSERT INTO user_absences (enterprise_id, user_id, starts_at, ends_at, reason)
  VALUES (p_enterprise_id, p_user_id, now(), until_ts, 'busy');

  PERFORM arm_timer(p_enterprise_id, NULL, 'busy_until', until_ts,
    jsonb_build_object('user_id', p_user_id));
  -- arm_timer requires ticket_id in old signature — patched below

  UPDATE tickets SET
    declined_user_ids = CASE
      WHEN p_user_id = ANY (declined_user_ids) THEN declined_user_ids
      ELSE array_append(declined_user_ids, p_user_id)
    END,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  RETURN pick_and_assign(p_enterprise_id, p_ticket_id, 'busy');
END;
$$;


-- ---------------------------------------------------------------------------
-- Append-only: ticket_events + audit_log
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % cannot be updated or deleted', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_append_only ON ticket_events;
CREATE TRIGGER trg_events_append_only
  BEFORE UPDATE OR DELETE ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_log;
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security (session: SET LOCAL app.enterprise_id)
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'enterprise_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (enterprise_id = current_setting(''app.enterprise_id'', true)::uuid)
         WITH CHECK (enterprise_id = current_setting(''app.enterprise_id'', true)::uuid)',
      r.tbl
    );
  END LOOP;
END;
$$;

-- Pin search_path on SECURITY DEFINER engine functions
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'assert_enterprise','current_enterprise_id','enqueue_outbox','record_event',
        'next_ticket_number','resolve_sla_policy','resolve_chain','add_business_minutes',
        'business_minutes_between','clear_open_timers','arm_timer','apply_ticket_policy',
        'enter_level','assign_level','pick_and_assign','respond_to_ticket','start_hold',
        'end_hold','escalate_ticket','acknowledge_escalation','resolve_ticket','reopen_ticket',
        'close_ticket','decline_assignment','mark_assignee_busy','claim_due_timer','consume_timer',
        'forbid_mutation','prevent_edit_published_chain'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I(%s) SECURITY DEFINER SET search_path = public',
      r.proname, r.args
    );
  END LOOP;
END;
$$;



-- =============================================================================
-- Ravi Nov 12 correction overlays (CREATE OR REPLACE)
-- =============================================================================

CREATE OR REPLACE FUNCTION record_event(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_event_type text,
  p_actor uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_key text;
  v_notify boolean;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  INSERT INTO ticket_events (enterprise_id, ticket_id, event_type, actor_user_id, payload)
  VALUES (p_enterprise_id, p_ticket_id, p_event_type, p_actor, p_payload)
  RETURNING id INTO v_id;

  v_notify := p_event_type IN (
    'assignment', 'responded', 'escalated', 'escalation_acked', 'escalation_exhausted',
    'resolved', 'reopened', 'closed', 'hold_started', 'hold_ended', 'sla_at_risk',
    'sla_breached', 'follow_up_created', 'unassigned'
  );
  IF v_notify THEN
    v_key := 'notify:' || p_ticket_id::text || ':' || p_event_type || ':' || v_id::text;
    PERFORM enqueue_outbox(p_enterprise_id, 'notify', jsonb_build_object(
      'ticket_id', p_ticket_id, 'event_type', p_event_type, 'event_id', v_id
    ), v_key);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION apply_ticket_policy(
  p_enterprise_id uuid,
  p_ticket_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  pol sla_policies%ROWTYPE;
  pr priority_rules%ROWTYPE;
  cat categories%ROWTYPE;
  prop properties%ROWTYPE;
  settings enterprise_settings%ROWTYPE;
  respond int;
  resolve int;
  start_at timestamptz;
  at_risk_pct numeric;
  at_risk_at timestamptz;
  cal uuid;
  use_biz boolean;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF t.is_imported AND t.status IN ('Resolved', 'Closed') THEN RETURN; END IF;

  SELECT * INTO settings FROM enterprise_settings WHERE enterprise_id = p_enterprise_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enterprise_settings missing for %', p_enterprise_id;
  END IF;

  pol := resolve_sla_policy(p_enterprise_id, t.category_id);
  SELECT * INTO cat FROM categories
  WHERE enterprise_id = p_enterprise_id AND id = t.category_id;
  respond := COALESCE(cat.respond_mins, pol.respond_mins);
  resolve := COALESCE(cat.resolve_mins, pol.resolve_mins);

  SELECT * INTO pr FROM priority_rules
  WHERE enterprise_id = p_enterprise_id AND priority = t.priority;
  IF FOUND THEN
    respond := CEIL(respond * pr.multiplier)::int;
    resolve := CEIL(resolve * pr.multiplier)::int;
  END IF;

  SELECT * INTO prop FROM properties
  WHERE enterprise_id = p_enterprise_id AND id = t.property_id;
  cal := prop.calendar_id;
  use_biz := NOT (COALESCE(pr.runs_24_7, false) OR cal IS NULL);

  start_at := COALESCE(t.clock_started_at, now());
  IF t.clock_started_at IS NULL THEN
    UPDATE tickets SET clock_started_at = start_at, updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    t.clock_started_at := start_at;
  END IF;

  at_risk_pct := settings.at_risk_pct;

  IF use_biz THEN
    UPDATE tickets SET
      tenant_respond_due = CASE WHEN t.first_response_at IS NOT NULL THEN tenant_respond_due
        ELSE add_business_minutes(p_enterprise_id, cal, start_at, respond + COALESCE(pause_total_mins, 0)) END,
      tenant_resolve_due = add_business_minutes(p_enterprise_id, cal, start_at, resolve + COALESCE(pause_total_mins, 0)),
      updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id
    RETURNING * INTO t;
  ELSE
    UPDATE tickets SET
      tenant_respond_due = CASE WHEN t.first_response_at IS NOT NULL THEN tenant_respond_due
        ELSE start_at + make_interval(mins => respond + COALESCE(pause_total_mins, 0)) END,
      tenant_resolve_due = start_at + make_interval(mins => resolve + COALESCE(pause_total_mins, 0)),
      updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id
    RETURNING * INTO t;
  END IF;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
    ARRAY['tenant_respond','tenant_resolve','at_risk']::timer_kind[]);

  IF t.first_response_at IS NULL AND t.tenant_respond_due IS NOT NULL THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'tenant_respond', t.tenant_respond_due);
    at_risk_at := t.tenant_respond_due - make_interval(
      mins => GREATEST(1, FLOOR(respond * at_risk_pct / 100.0)::int));
    IF at_risk_at > now() THEN
      PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'at_risk', at_risk_at,
        jsonb_build_object('window', 'respond'));
    END IF;
  END IF;

  IF t.tenant_resolve_due IS NOT NULL THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'tenant_resolve', t.tenant_resolve_due);
    at_risk_at := t.tenant_resolve_due - make_interval(
      mins => GREATEST(1, FLOOR(resolve * at_risk_pct / 100.0)::int));
    IF at_risk_at > now() THEN
      PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'at_risk', at_risk_at,
        jsonb_build_object('window', 'resolve'));
    END IF;
  END IF;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'policy_applied', NULL,
    jsonb_build_object('respond_mins', respond, 'resolve_mins', resolve));
END;
$$;

CREATE OR REPLACE FUNCTION assign_level(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_to_user_id uuid,
  p_reason assignment_reason,
  p_from_user_id uuid DEFAULT NULL,
  p_backup_user_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  lvl_id uuid;
  v_id uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  SELECT id INTO lvl_id FROM ticket_levels
  WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND left_at IS NULL
  ORDER BY entered_at DESC LIMIT 1;

  UPDATE ticket_assignments SET released_at = now()
  WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND released_at IS NULL;

  INSERT INTO ticket_assignments (
    enterprise_id, ticket_id, ticket_level_id, from_user_id, to_user_id, reason, note
  ) VALUES (
    p_enterprise_id, p_ticket_id, lvl_id,
    COALESCE(p_from_user_id, t.primary_user_id),
    p_to_user_id, p_reason, p_note
  ) RETURNING id INTO v_id;

  UPDATE tickets SET
    primary_user_id = p_to_user_id,
    backup_user_id = CASE
      WHEN p_to_user_id IS NULL THEN NULL
      ELSE p_backup_user_id
    END,
    declined_user_ids = CASE
      WHEN p_reason IN ('reassign', 'escalate_ack') THEN '{}'::uuid[]
      ELSE declined_user_ids
    END,
    status = CASE
      WHEN p_to_user_id IS NULL THEN 'Unassigned'::ticket_status
      WHEN status = 'Unassigned' THEN 'Open'::ticket_status
      ELSE status
    END,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  IF t.primary_user_id IS NOT NULL AND t.primary_user_id IS DISTINCT FROM p_to_user_id THEN
    UPDATE users SET open_ticket_count = GREATEST(0, open_ticket_count - 1)
    WHERE enterprise_id = p_enterprise_id AND id = t.primary_user_id;
  END IF;
  IF p_to_user_id IS NOT NULL AND t.primary_user_id IS DISTINCT FROM p_to_user_id THEN
    UPDATE users SET last_assigned_at = now(), open_ticket_count = open_ticket_count + 1
    WHERE enterprise_id = p_enterprise_id AND id = p_to_user_id;
  ELSIF p_to_user_id IS NOT NULL THEN
    UPDATE users SET last_assigned_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_to_user_id;
  END IF;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'assignment', NULL,
    jsonb_build_object('to', p_to_user_id, 'reason', p_reason));
  IF p_to_user_id IS NULL THEN
    PERFORM record_event(p_enterprise_id, p_ticket_id, 'unassigned', NULL, '{}');
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION user_covers_property(
  p_enterprise_id uuid, p_user_id uuid, p_property_id uuid
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM user_properties up
    WHERE up.enterprise_id = p_enterprise_id AND up.user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM user_properties up
    WHERE up.enterprise_id = p_enterprise_id AND up.user_id = p_user_id
      AND up.property_id = p_property_id
  );
$$;

CREATE OR REPLACE FUNCTION user_eligible_for_category(
  p_enterprise_id uuid, p_user_id uuid, p_category_id uuid, p_property_id uuid
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    JOIN user_skills us ON us.enterprise_id = u.enterprise_id AND us.user_id = u.id
    WHERE u.enterprise_id = p_enterprise_id AND u.id = p_user_id
      AND us.category_id = p_category_id
      AND u.status = 'active'
      AND u.availability IN ('Available', 'On call')
      AND (u.busy_until IS NULL OR u.busy_until <= now())
      AND (u.unavailable_until IS NULL OR u.unavailable_until <= now())
      AND user_covers_property(p_enterprise_id, p_user_id, p_property_id)
  );
$$;

CREATE OR REPLACE FUNCTION pick_and_assign(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_reason assignment_reason DEFAULT 'initial_route'
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  rr routing_rules%ROWTYPE;
  primary_id uuid;
  backup_id uuid;
  from_id uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;
  from_id := t.primary_user_id;

  PERFORM pg_advisory_xact_lock(hashtext(p_enterprise_id::text || ':' || COALESCE(t.category_id::text, '')));

  SELECT * INTO rr FROM routing_rules
  WHERE enterprise_id = p_enterprise_id
    AND property_id = t.property_id
    AND category_id = t.category_id;

  IF FOUND AND rr.preferred_user_id IS NOT NULL
     AND NOT (rr.preferred_user_id = ANY (t.declined_user_ids))
     AND user_eligible_for_category(p_enterprise_id, rr.preferred_user_id, t.category_id, t.property_id)
  THEN
    primary_id := rr.preferred_user_id;
    IF rr.backup_user_id IS NOT NULL
       AND NOT (rr.backup_user_id = ANY (t.declined_user_ids))
       AND user_eligible_for_category(p_enterprise_id, rr.backup_user_id, t.category_id, t.property_id)
    THEN
      backup_id := rr.backup_user_id;
    END IF;
    IF rr.manager_user_id IS NOT NULL THEN
      UPDATE tickets SET manager_user_id = rr.manager_user_id
      WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    END IF;
  END IF;

  IF primary_id IS NULL THEN
    SELECT u.id INTO primary_id
    FROM users u
    JOIN user_skills us ON us.enterprise_id = u.enterprise_id AND us.user_id = u.id
    WHERE u.enterprise_id = p_enterprise_id
      AND us.category_id = t.category_id
      AND u.status = 'active'
      AND u.availability IN ('Available', 'On call')
      AND (u.busy_until IS NULL OR u.busy_until <= now())
      AND (u.unavailable_until IS NULL OR u.unavailable_until <= now())
      AND NOT (u.id = ANY (t.declined_user_ids))
      AND user_covers_property(p_enterprise_id, u.id, t.property_id)
    ORDER BY u.open_ticket_count ASC, u.last_assigned_at ASC NULLS FIRST
    FOR UPDATE OF u SKIP LOCKED
    LIMIT 1;
  END IF;

  IF primary_id IS NOT NULL AND backup_id IS NULL THEN
    SELECT u.id INTO backup_id
    FROM users u
    JOIN user_skills us ON us.enterprise_id = u.enterprise_id AND us.user_id = u.id
    WHERE u.enterprise_id = p_enterprise_id
      AND us.category_id = t.category_id
      AND u.status = 'active'
      AND u.availability IN ('Available', 'On call')
      AND (u.busy_until IS NULL OR u.busy_until <= now())
      AND u.id <> primary_id
      AND NOT (u.id = ANY (t.declined_user_ids))
      AND user_covers_property(p_enterprise_id, u.id, t.property_id)
    ORDER BY u.open_ticket_count ASC, u.last_assigned_at ASC NULLS FIRST
    FOR UPDATE OF u SKIP LOCKED
    LIMIT 1;
  END IF;

  RETURN assign_level(p_enterprise_id, p_ticket_id, primary_id, p_reason, from_id, backup_id);
END;
$$;

CREATE OR REPLACE FUNCTION create_ticket(
  p_enterprise_id uuid,
  p_property_id uuid,
  p_unit_id uuid,
  p_tenant_id uuid,
  p_lease_id uuid,
  p_category_id uuid,
  p_channel text,
  p_subject text,
  p_notes text,
  p_priority priority_code DEFAULT 'Normal',
  p_actor uuid DEFAULT NULL,
  p_is_imported boolean DEFAULT false,
  p_import_status ticket_status DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_num text;
  v_chain escalation_chains%ROWTYPE;
  v_status ticket_status;
  v_unit units%ROWTYPE;
  v_lease leases%ROWTYPE;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);

  IF NOT EXISTS (SELECT 1 FROM enterprise_settings WHERE enterprise_id = p_enterprise_id) THEN
    RAISE EXCEPTION 'enterprise_settings missing for %', p_enterprise_id;
  END IF;

  IF p_unit_id IS NOT NULL THEN
    SELECT * INTO v_unit FROM units WHERE enterprise_id = p_enterprise_id AND id = p_unit_id;
    IF v_unit.property_id IS DISTINCT FROM p_property_id THEN
      RAISE EXCEPTION 'unit does not belong to property';
    END IF;
  END IF;
  IF p_lease_id IS NOT NULL THEN
    SELECT * INTO v_lease FROM leases WHERE enterprise_id = p_enterprise_id AND id = p_lease_id;
    IF p_unit_id IS NOT NULL AND v_lease.unit_id IS DISTINCT FROM p_unit_id THEN
      RAISE EXCEPTION 'lease does not belong to unit';
    END IF;
  END IF;

  v_chain := resolve_chain(p_enterprise_id, p_category_id, p_property_id);
  v_num := next_ticket_number(p_enterprise_id);
  v_status := COALESCE(p_import_status, 'Open'::ticket_status);

  INSERT INTO tickets (
    enterprise_id, ticket_number, property_id, unit_id, tenant_id, lease_id,
    category_id, channel, subject, priority, status, chain_id, is_imported,
    clock_started_at
  ) VALUES (
    p_enterprise_id, v_num, p_property_id, p_unit_id, p_tenant_id, p_lease_id,
    p_category_id, p_channel, p_subject, p_priority, v_status,
    v_chain.id, p_is_imported,
    CASE WHEN p_is_imported AND v_status IN ('Resolved','Closed') THEN NULL ELSE now() END
  ) RETURNING id INTO v_id;

  IF p_notes IS NOT NULL AND length(trim(p_notes)) > 0 THEN
    INSERT INTO ticket_comments (enterprise_id, ticket_id, author_user_id, visibility, body)
    VALUES (p_enterprise_id, v_id, p_actor, 'internal', p_notes);
  END IF;

  PERFORM record_event(p_enterprise_id, v_id, 'created', p_actor, jsonb_build_object('number', v_num));
  PERFORM enqueue_outbox(p_enterprise_id, 'ai_enrich',
    jsonb_build_object('ticket_id', v_id), 'ai_enrich:' || v_id::text);

  IF NOT (p_is_imported AND v_status IN ('Resolved','Closed')) THEN
    PERFORM enter_level(p_enterprise_id, v_id, 0);
    PERFORM apply_ticket_policy(p_enterprise_id, v_id);
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION start_hold(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_reason_id uuid,
  p_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  hr hold_reasons%ROWTYPE;
  v_id uuid;
  pauses boolean;
  pause_level boolean;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;
  IF t.status NOT IN ('Open', 'In Progress') THEN
    RAISE EXCEPTION 'cannot hold from status %', t.status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM ticket_holds
    WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ticket already on hold';
  END IF;

  SELECT * INTO hr FROM hold_reasons
  WHERE enterprise_id = p_enterprise_id AND id = p_reason_id;
  pauses := COALESCE(hr.pauses_tenant_sla, true);
  pause_level := COALESCE(hr.pauses_level_timers, false);

  INSERT INTO ticket_holds (
    enterprise_id, ticket_id, reason_id, pauses_tenant_sla, started_by
  ) VALUES (
    p_enterprise_id, p_ticket_id, p_reason_id, pauses, p_user_id
  ) RETURNING id INTO v_id;

  UPDATE tickets SET
    status_before_hold = t.status,
    status = 'On Hold',
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  IF pauses THEN
    PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
      ARRAY['tenant_respond','tenant_resolve','at_risk']::timer_kind[]);
  END IF;
  IF pause_level THEN
    PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
      ARRAY['level_respond','level_resolve','escalation_ack']::timer_kind[]);
  END IF;

  IF hr.limit_mins IS NOT NULL THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'hold_limit',
      now() + make_interval(mins => hr.limit_mins),
      jsonb_build_object('hold_id', v_id));
  END IF;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'hold_started', p_user_id,
    jsonb_build_object('hold_id', v_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION end_hold(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_hold_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  h ticket_holds%ROWTYPE;
  prop properties%ROWTYPE;
  cal uuid;
  dur int;
  restore ticket_status;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  SELECT * INTO h FROM ticket_holds
  WHERE enterprise_id = p_enterprise_id
    AND ticket_id = p_ticket_id
    AND ended_at IS NULL
    AND (p_hold_id IS NULL OR id = p_hold_id)
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no open hold'; END IF;

  SELECT * INTO prop FROM properties
  WHERE enterprise_id = p_enterprise_id AND id = t.property_id;
  cal := prop.calendar_id;

  IF cal IS NOT NULL THEN
    dur := business_minutes_between(p_enterprise_id, cal, h.started_at, now());
  ELSE
    dur := FLOOR(EXTRACT(EPOCH FROM (now() - h.started_at)) / 60.0)::int;
  END IF;

  UPDATE ticket_holds SET ended_at = now(), duration_mins = dur
  WHERE enterprise_id = p_enterprise_id AND id = h.id;

  restore := COALESCE(t.status_before_hold, 'In Progress'::ticket_status);
  UPDATE tickets SET
    status = restore,
    status_before_hold = NULL,
    hold_total_mins = hold_total_mins + dur,
    pause_total_mins = pause_total_mins + CASE WHEN h.pauses_tenant_sla THEN dur ELSE 0 END,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, ARRAY['hold_limit']::timer_kind[]);
  IF h.pauses_tenant_sla THEN
    PERFORM apply_ticket_policy(p_enterprise_id, p_ticket_id);
  END IF;
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'hold_ended', NULL,
    jsonb_build_object('hold_id', h.id, 'duration_mins', dur));
END;
$$;

CREATE OR REPLACE FUNCTION escalate_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid
) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  next_level int;
  max_level int;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.status IN ('Resolved', 'Closed', 'Cancelled', 'Duplicate') THEN
    RAISE EXCEPTION 'cannot escalate from status %', t.status;
  END IF;
  IF t.chain_id IS NULL THEN
    RAISE EXCEPTION 'ticket has no escalation chain';
  END IF;
  IF t.escalation_state = 'exhausted' THEN
    RETURN t.current_level_no;
  END IF;

  SELECT COALESCE(MAX(level_no), 0) INTO max_level
  FROM escalation_levels
  WHERE enterprise_id = p_enterprise_id AND chain_id = t.chain_id;

  -- Already at top level: mark exhausted once; do not re-enter the level.
  IF COALESCE(t.current_level_no, 0) >= max_level THEN
    UPDATE tickets SET escalation_state = 'exhausted', updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
      ARRAY['escalation_ack','level_respond','level_resolve']::timer_kind[]);
    PERFORM enqueue_outbox(p_enterprise_id, 'notify',
      jsonb_build_object('ticket_id', p_ticket_id, 'event_type', 'escalation_exhausted'),
      'notify:' || p_ticket_id::text || ':escalation_exhausted');
    PERFORM record_event(p_enterprise_id, p_ticket_id, 'escalation_exhausted', NULL,
      jsonb_build_object('level_no', t.current_level_no));
    RETURN t.current_level_no;
  END IF;

  next_level := COALESCE(t.current_level_no, 0) + 1;

  UPDATE tickets SET
    escalation_level = next_level,
    escalation_state = 'waiting',
    current_level_no = next_level,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM enter_level(p_enterprise_id, p_ticket_id, next_level);
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'escalated', NULL,
    jsonb_build_object('level_no', next_level));
  RETURN next_level;
END;
$$;

CREATE OR REPLACE FUNCTION acknowledge_escalation(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  ok boolean;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.escalation_state <> 'waiting' THEN
    RAISE EXCEPTION 'ticket is not waiting on escalation';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM escalation_levels el
    JOIN escalation_level_roles elr ON elr.enterprise_id = el.enterprise_id AND elr.level_id = el.id
    JOIN users u ON u.enterprise_id = elr.enterprise_id AND u.role_id = elr.role_id
    WHERE el.enterprise_id = p_enterprise_id
      AND el.chain_id = t.chain_id
      AND el.level_no = t.current_level_no
      AND u.id = p_user_id
  ) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'user is not in the current escalation level role pool';
  END IF;

  UPDATE ticket_levels SET
    acknowledged_at = now(),
    acknowledged_by = p_user_id,
    left_at = now()
  WHERE enterprise_id = p_enterprise_id
    AND ticket_id = p_ticket_id
    AND left_at IS NULL;

  UPDATE tickets SET
    escalation_state = 'none',
    escalation_level = 0,
    current_level_no = 0,
    declined_user_ids = '{}',
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'escalation_acked', p_user_id,
    jsonb_build_object('anti_loop', true));
  PERFORM enter_level(p_enterprise_id, p_ticket_id, 0);
  PERFORM pick_and_assign(p_enterprise_id, p_ticket_id, 'escalate_ack');
END;
$$;

CREATE OR REPLACE FUNCTION resolve_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  cal uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.escalation_state = 'waiting' THEN
    RAISE EXCEPTION 'ESCALATION_OPEN: cannot resolve while escalation waiting';
  END IF;
  IF t.primary_user_id IS NULL OR t.status = 'Unassigned' THEN
    RAISE EXCEPTION 'cannot resolve without primary assignee';
  END IF;
  IF t.first_response_at IS NULL THEN
    RAISE EXCEPTION 'cannot resolve before first response';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ticket_holds
    WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot resolve while hold is open';
  END IF;
  IF t.status IN ('Resolved', 'Closed', 'Cancelled', 'Duplicate') THEN
    RAISE EXCEPTION 'already resolved/closed';
  END IF;

  SELECT calendar_id INTO cal FROM properties
  WHERE enterprise_id = p_enterprise_id AND id = t.property_id;

  UPDATE tickets SET
    status = 'Resolved',
    resolved_at = now(),
    rtat_mins = CASE
      WHEN clock_started_at IS NOT NULL THEN
        GREATEST(0, business_minutes_between(p_enterprise_id, cal, clock_started_at, now())
          - pause_total_mins)
      ELSE NULL
    END,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  IF t.primary_user_id IS NOT NULL THEN
    UPDATE users SET open_ticket_count = GREATEST(0, open_ticket_count - 1)
    WHERE enterprise_id = p_enterprise_id AND id = t.primary_user_id;
  END IF;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, NULL);
  PERFORM arm_timer(
    p_enterprise_id, p_ticket_id, 'auto_close',
    now() + (
      SELECT make_interval(days => s.auto_close_days)
      FROM enterprise_settings s WHERE s.enterprise_id = p_enterprise_id
    )
  );
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'resolved', p_user_id, '{}');
END;
$$;

CREATE OR REPLACE FUNCTION reopen_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  days int;
  new_id uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  SELECT reopen_window_days INTO days FROM enterprise_settings WHERE enterprise_id = p_enterprise_id;
  IF days IS NULL THEN
    RAISE EXCEPTION 'enterprise_settings missing';
  END IF;

  IF t.status = 'Resolved' THEN
    UPDATE tickets SET
      status = 'In Progress',
      resolved_at = NULL,
      closed_at = NULL,
      rtat_mins = NULL,
      reopen_count = reopen_count + 1,
      clock_started_at = now(),
      updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    IF t.primary_user_id IS NOT NULL THEN
      UPDATE users SET open_ticket_count = open_ticket_count + 1
      WHERE enterprise_id = p_enterprise_id AND id = t.primary_user_id;
    END IF;
    PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, ARRAY['auto_close']::timer_kind[]);
    PERFORM apply_ticket_policy(p_enterprise_id, p_ticket_id);
    PERFORM record_event(p_enterprise_id, p_ticket_id, 'reopened', p_user_id, '{}');
    RETURN p_ticket_id;
  END IF;

  IF t.status <> 'Closed' THEN
    RAISE EXCEPTION 'ticket not reopenable';
  END IF;

  IF t.closed_at IS NOT NULL AND t.closed_at + make_interval(days => days) >= now() THEN
    UPDATE tickets SET
      status = 'In Progress',
      resolved_at = NULL,
      closed_at = NULL,
      rtat_mins = NULL,
      reopen_count = reopen_count + 1,
      clock_started_at = now(),
      updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    IF t.primary_user_id IS NOT NULL THEN
      UPDATE users SET open_ticket_count = open_ticket_count + 1
      WHERE enterprise_id = p_enterprise_id AND id = t.primary_user_id;
    END IF;
    PERFORM apply_ticket_policy(p_enterprise_id, p_ticket_id);
    PERFORM record_event(p_enterprise_id, p_ticket_id, 'reopened', p_user_id, '{}');
    RETURN p_ticket_id;
  END IF;

  -- Outside reopen window: open a follow-up ticket (do not raise — that would roll back the insert).
  new_id := create_ticket(
    p_enterprise_id, t.property_id, t.unit_id, t.tenant_id, t.lease_id,
    t.category_id, t.channel, t.subject, NULL, t.priority, p_user_id, false, NULL
  );
  UPDATE tickets SET follow_up_of = t.id WHERE enterprise_id = p_enterprise_id AND id = new_id;
  PERFORM record_event(p_enterprise_id, new_id, 'follow_up_created', p_user_id,
    jsonb_build_object('from', p_ticket_id));
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION close_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t tickets%ROWTYPE;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;
  IF t.status <> 'Resolved' THEN
    RAISE EXCEPTION 'only resolved tickets can close';
  END IF;
  UPDATE tickets SET status = 'Closed', closed_at = now(), updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, NULL);
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'closed', NULL, '{}');
END;
$$;

CREATE OR REPLACE FUNCTION decline_assignment(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE t tickets%ROWTYPE;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.first_response_at IS NOT NULL THEN
    RAISE EXCEPTION 'HANDOFF_FROZEN: handoff frozen after accept; escalate or reassign';
  END IF;
  IF t.primary_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only primary can decline';
  END IF;

  UPDATE tickets SET
    declined_user_ids = array_append(declined_user_ids, p_user_id),
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  RETURN pick_and_assign(p_enterprise_id, p_ticket_id, 'declined');
END;
$$;

CREATE OR REPLACE FUNCTION mark_assignee_busy(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid,
  p_busy_mins int DEFAULT 60
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  until_ts timestamptz;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.first_response_at IS NOT NULL THEN
    RAISE EXCEPTION 'HANDOFF_FROZEN: handoff frozen after accept; escalate or reassign';
  END IF;
  IF t.primary_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'only primary can mark busy';
  END IF;

  until_ts := now() + make_interval(mins => GREATEST(1, COALESCE(p_busy_mins, 60)));
  UPDATE users SET availability = 'Unavailable', busy_until = until_ts, unavailable_until = until_ts
  WHERE enterprise_id = p_enterprise_id AND id = p_user_id;

  INSERT INTO user_absences (enterprise_id, user_id, starts_at, ends_at, reason)
  VALUES (p_enterprise_id, p_user_id, now(), until_ts, 'busy');

  PERFORM arm_timer(p_enterprise_id, NULL, 'busy_until', until_ts,
    jsonb_build_object('user_id', p_user_id), p_user_id);

  UPDATE tickets SET
    declined_user_ids = CASE
      WHEN p_user_id = ANY (declined_user_ids) THEN declined_user_ids
      ELSE array_append(declined_user_ids, p_user_id)
    END,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  RETURN pick_and_assign(p_enterprise_id, p_ticket_id, 'busy');
END;
$$;

-- Performance indexes (§5.1)
CREATE INDEX IF NOT EXISTS ticket_timers_open_by_ticket_idx
  ON ticket_timers (enterprise_id, ticket_id)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS user_skills_category_idx
  ON user_skills (enterprise_id, category_id);
CREATE INDEX IF NOT EXISTS ticket_holds_open_idx
  ON ticket_holds (enterprise_id, ticket_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (enterprise_id, user_id, read_at);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (enterprise_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS tickets_property_fk_idx ON tickets (enterprise_id, property_id);
CREATE INDEX IF NOT EXISTS tickets_category_fk_idx ON tickets (enterprise_id, category_id);
CREATE INDEX IF NOT EXISTS tickets_unit_fk_idx ON tickets (enterprise_id, unit_id);
CREATE INDEX IF NOT EXISTS tickets_tenant_fk_idx ON tickets (enterprise_id, tenant_id);
CREATE INDEX IF NOT EXISTS tickets_lease_fk_idx ON tickets (enterprise_id, lease_id);

-- Chain child immutability when published + in use
CREATE OR REPLACE FUNCTION prevent_edit_chain_children()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_chain uuid;
  v_ent uuid;
  v_status chain_status;
BEGIN
  IF TG_TABLE_NAME = 'escalation_levels' THEN
    v_chain := COALESCE(NEW.chain_id, OLD.chain_id);
    v_ent := COALESCE(NEW.enterprise_id, OLD.enterprise_id);
  ELSIF TG_TABLE_NAME = 'escalation_level_roles' THEN
    SELECT el.chain_id, el.enterprise_id INTO v_chain, v_ent
    FROM escalation_levels el
    WHERE el.enterprise_id = COALESCE(NEW.enterprise_id, OLD.enterprise_id)
      AND el.id = COALESCE(NEW.level_id, OLD.level_id);
  ELSIF TG_TABLE_NAME = 'escalation_severity_rules' THEN
    v_chain := COALESCE(NEW.chain_id, OLD.chain_id);
    v_ent := COALESCE(NEW.enterprise_id, OLD.enterprise_id);
  END IF;

  SELECT status INTO v_status FROM escalation_chains
  WHERE enterprise_id = v_ent AND id = v_chain;
  IF v_status = 'published' AND EXISTS (
    SELECT 1 FROM tickets t WHERE t.enterprise_id = v_ent AND t.chain_id = v_chain
  ) THEN
    RAISE EXCEPTION 'published escalation chain % children cannot be edited while in use', v_chain;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_levels_immutable ON escalation_levels;
CREATE TRIGGER trg_levels_immutable
  BEFORE UPDATE OR DELETE ON escalation_levels
  FOR EACH ROW EXECUTE FUNCTION prevent_edit_chain_children();
DROP TRIGGER IF EXISTS trg_level_roles_immutable ON escalation_level_roles;
CREATE TRIGGER trg_level_roles_immutable
  BEFORE UPDATE OR DELETE ON escalation_level_roles
  FOR EACH ROW EXECUTE FUNCTION prevent_edit_chain_children();
DROP TRIGGER IF EXISTS trg_sev_rules_immutable ON escalation_severity_rules;
CREATE TRIGGER trg_sev_rules_immutable
  BEFORE UPDATE OR DELETE ON escalation_severity_rules
  FOR EACH ROW EXECUTE FUNCTION prevent_edit_chain_children();

-- Pin search_path for new helpers
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_ticket','user_covers_property','user_eligible_for_category',
        'prevent_edit_chain_children'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I(%s) SECURITY DEFINER SET search_path = public',
      r.proname, r.args
    );
  END LOOP;
END;
$$;



-- =============================================================================
-- Final schema closeout (Ravi full checklist) — CREATE OR REPLACE overlays
-- =============================================================================

-- Outbox enqueue compatible with partitioned unique index
CREATE OR REPLACE FUNCTION enqueue_outbox(
  p_enterprise_id uuid,
  p_kind outbox_kind,
  p_payload jsonb DEFAULT '{}',
  p_dedupe_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  IF p_dedupe_key IS NOT NULL THEN
    SELECT id INTO v_id FROM outbox_events
    WHERE enterprise_id = p_enterprise_id AND dedupe_key = p_dedupe_key
    ORDER BY created_at DESC LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  INSERT INTO outbox_events (enterprise_id, kind, payload, dedupe_key)
  VALUES (p_enterprise_id, p_kind, p_payload, p_dedupe_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION assert_licence_active(p_enterprise_id uuid)
RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE lic licenses%ROWTYPE;
BEGIN
  SELECT * INTO lic FROM licenses
  WHERE enterprise_id = p_enterprise_id AND is_current
  ORDER BY expires_on DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LICENCE_MISSING: no current licence for enterprise %', p_enterprise_id;
  END IF;
  IF lic.expires_on + make_interval(days => lic.grace_days) < CURRENT_DATE THEN
    RAISE EXCEPTION 'LICENCE_EXPIRED: enterprise % licence ended %', p_enterprise_id, lic.expires_on;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION priority_rank(p priority_code)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'Low' THEN 1 WHEN 'Normal' THEN 2 WHEN 'High' THEN 3 WHEN 'Urgent' THEN 4
    ELSE 2 END;
$$;

CREATE OR REPLACE FUNCTION priority_from_rank(r int)
RETURNS priority_code LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE GREATEST(1, LEAST(4, r))
    WHEN 1 THEN 'Low'::priority_code
    WHEN 2 THEN 'Normal'::priority_code
    WHEN 3 THEN 'High'::priority_code
    ELSE 'Urgent'::priority_code END;
$$;

CREATE OR REPLACE FUNCTION cap_priority_raise(
  p_current priority_code,
  p_predicted priority_code,
  p_cap int
) RETURNS priority_code LANGUAGE sql IMMUTABLE AS $$
  SELECT priority_from_rank(LEAST(
    priority_rank(p_predicted),
    priority_rank(p_current) + GREATEST(0, COALESCE(p_cap, 0))
  ));
$$;

CREATE OR REPLACE FUNCTION category_is_leaf(
  p_enterprise_id uuid, p_category_id uuid
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.enterprise_id = p_enterprise_id AND c.parent_id = p_category_id AND c.is_active
  );
$$;

-- Category-tree chain walk
CREATE OR REPLACE FUNCTION resolve_chain(
  p_enterprise_id uuid,
  p_category_id uuid,
  p_property_id uuid
) RETURNS escalation_chains
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v escalation_chains;
  cat uuid := p_category_id;
  parent uuid;
BEGIN
  WHILE cat IS NOT NULL LOOP
    IF p_property_id IS NOT NULL THEN
      SELECT * INTO v FROM escalation_chains
      WHERE enterprise_id = p_enterprise_id AND status = 'published'
        AND category_id = cat AND property_id = p_property_id
      ORDER BY version DESC LIMIT 1;
      IF FOUND THEN RETURN v; END IF;
    END IF;

    SELECT * INTO v FROM escalation_chains
    WHERE enterprise_id = p_enterprise_id AND status = 'published'
      AND category_id = cat AND property_id IS NULL
    ORDER BY version DESC LIMIT 1;
    IF FOUND THEN RETURN v; END IF;

    SELECT parent_id INTO parent FROM categories
    WHERE enterprise_id = p_enterprise_id AND id = cat;
    cat := parent;
  END LOOP;

  SELECT * INTO v FROM escalation_chains
  WHERE enterprise_id = p_enterprise_id AND status = 'published'
    AND category_id IS NULL AND property_id IS NULL
  ORDER BY version DESC LIMIT 1;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION tickets_cross_column_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_prop uuid;
  v_unit uuid;
BEGIN
  IF NEW.unit_id IS NOT NULL THEN
    SELECT property_id INTO v_prop FROM units
    WHERE enterprise_id = NEW.enterprise_id AND id = NEW.unit_id;
    IF v_prop IS DISTINCT FROM NEW.property_id THEN
      RAISE EXCEPTION 'unit does not belong to property';
    END IF;
  END IF;
  IF NEW.lease_id IS NOT NULL THEN
    SELECT unit_id INTO v_unit FROM leases
    WHERE enterprise_id = NEW.enterprise_id AND id = NEW.lease_id;
    IF NEW.unit_id IS NOT NULL AND v_unit IS DISTINCT FROM NEW.unit_id THEN
      RAISE EXCEPTION 'lease does not belong to unit';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_cross_column ON tickets;
CREATE TRIGGER trg_tickets_cross_column
  BEFORE INSERT OR UPDATE OF property_id, unit_id, lease_id ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_cross_column_check();

CREATE OR REPLACE FUNCTION fanout_level_notify(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_level_no int
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  uid uuid;
  lvl escalation_levels%ROWTYPE;
BEGIN
  SELECT * INTO t FROM tickets WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
  IF t.chain_id IS NULL THEN RETURN; END IF;
  SELECT * INTO lvl FROM escalation_levels
  WHERE enterprise_id = p_enterprise_id AND chain_id = t.chain_id AND level_no = p_level_no;
  IF NOT FOUND THEN RETURN; END IF;

  FOR uid IN
    SELECT DISTINCT u.id
    FROM escalation_level_roles elr
    JOIN users u ON u.enterprise_id = elr.enterprise_id AND u.role_id = elr.role_id
    WHERE elr.enterprise_id = p_enterprise_id AND elr.level_id = lvl.id
      AND u.status = 'active'
  LOOP
    PERFORM enqueue_outbox(p_enterprise_id, 'notify',
      jsonb_build_object('ticket_id', p_ticket_id, 'user_id', uid, 'event_type', 'escalation_level',
                         'level_no', p_level_no, 'mode', lvl.mode),
      'notify:level:' || p_ticket_id::text || ':' || p_level_no::text || ':' || uid::text);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION apply_severity_window_factor(
  p_enterprise_id uuid,
  p_chain_id uuid,
  p_severity text,
  p_mins int
) RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE fac numeric := 1.0;
BEGIN
  IF p_mins IS NULL THEN RETURN NULL; END IF;
  SELECT window_factor INTO fac FROM escalation_severity_rules
  WHERE enterprise_id = p_enterprise_id AND chain_id = p_chain_id
    AND min_severity = p_severity
  ORDER BY window_factor ASC LIMIT 1;
  RETURN GREATEST(1, CEIL(p_mins * COALESCE(fac, 1.0))::int);
END;
$$;

CREATE OR REPLACE FUNCTION severity_skip_level(
  p_enterprise_id uuid, p_chain_id uuid, p_severity text, p_current int
) RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE skip_to int;
BEGIN
  SELECT skip_to_level INTO skip_to FROM escalation_severity_rules
  WHERE enterprise_id = p_enterprise_id AND chain_id = p_chain_id
    AND min_severity = p_severity AND skip_to_level IS NOT NULL
  ORDER BY skip_to_level DESC LIMIT 1;
  IF skip_to IS NOT NULL AND skip_to > p_current THEN
    RETURN skip_to;
  END IF;
  RETURN p_current;
END;
$$;

CREATE OR REPLACE FUNCTION enter_level(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_level_no int
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  lvl escalation_levels%ROWTYPE;
  v_id uuid;
  v_ack timestamptz;
  respond_m int;
  resolve_m int;
  force247 boolean := false;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  UPDATE ticket_levels SET left_at = now()
  WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND left_at IS NULL;

  IF t.chain_id IS NOT NULL THEN
    SELECT * INTO lvl FROM escalation_levels
    WHERE enterprise_id = p_enterprise_id AND chain_id = t.chain_id AND level_no = p_level_no;
  END IF;

  respond_m := apply_severity_window_factor(p_enterprise_id, t.chain_id, t.severity, lvl.respond_mins);
  resolve_m := apply_severity_window_factor(p_enterprise_id, t.chain_id, t.severity, lvl.resolve_mins);
  SELECT COALESCE(bool_or(force_24_7), false) INTO force247
  FROM escalation_severity_rules
  WHERE enterprise_id = p_enterprise_id AND chain_id = t.chain_id AND min_severity = t.severity;

  v_ack := CASE WHEN lvl.ack_mins IS NOT NULL
    THEN now() + make_interval(mins => lvl.ack_mins) ELSE NULL END;

  INSERT INTO ticket_levels (
    enterprise_id, ticket_id, level_no, respond_due, resolve_due, ack_due
  ) VALUES (
    p_enterprise_id, p_ticket_id, p_level_no,
    CASE WHEN respond_m IS NOT NULL THEN now() + make_interval(mins => respond_m) END,
    CASE WHEN resolve_m IS NOT NULL THEN now() + make_interval(mins => resolve_m) END,
    v_ack
  ) RETURNING id INTO v_id;

  UPDATE tickets SET current_level_no = p_level_no, updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
    ARRAY['level_respond','level_resolve','escalation_ack']::timer_kind[]);

  IF respond_m IS NOT NULL THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'level_respond',
      now() + make_interval(mins => respond_m),
      jsonb_build_object('force_24_7', force247));
  END IF;
  IF resolve_m IS NOT NULL THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'level_resolve',
      now() + make_interval(mins => resolve_m),
      jsonb_build_object('force_24_7', force247));
  END IF;
  IF v_ack IS NOT NULL AND p_level_no > 0 THEN
    PERFORM arm_timer(p_enterprise_id, p_ticket_id, 'escalation_ack', v_ack);
  END IF;

  IF p_level_no > 0 THEN
    PERFORM fanout_level_notify(p_enterprise_id, p_ticket_id, p_level_no);
  END IF;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'enter_level', NULL,
    jsonb_build_object('level_no', p_level_no, 'mode', lvl.mode));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION pick_and_assign(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_reason assignment_reason DEFAULT 'initial_route'
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  rr routing_rules%ROWTYPE;
  lvl escalation_levels%ROWTYPE;
  primary_id uuid;
  backup_id uuid;
  from_id uuid;
  cap int;
  nf nobody_free_action;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;
  from_id := t.primary_user_id;

  PERFORM pg_advisory_xact_lock(hashtext(p_enterprise_id::text || ':' || COALESCE(t.category_id::text, '')));

  IF t.chain_id IS NOT NULL THEN
    SELECT * INTO lvl FROM escalation_levels
    WHERE enterprise_id = p_enterprise_id AND chain_id = t.chain_id AND level_no = t.current_level_no;
    cap := lvl.workload_cap;
    nf := COALESCE(lvl.nobody_free, 'escalate'::nobody_free_action);
  ELSE
    nf := 'escalate'::nobody_free_action;
  END IF;

  SELECT * INTO rr FROM routing_rules
  WHERE enterprise_id = p_enterprise_id
    AND property_id = t.property_id
    AND category_id = t.category_id;

  IF FOUND AND rr.preferred_user_id IS NOT NULL
     AND NOT (rr.preferred_user_id = ANY (t.declined_user_ids))
     AND user_eligible_for_category(p_enterprise_id, rr.preferred_user_id, t.category_id, t.property_id)
     AND (cap IS NULL OR (SELECT open_ticket_count FROM users WHERE id = rr.preferred_user_id AND enterprise_id = p_enterprise_id) < cap)
  THEN
    primary_id := rr.preferred_user_id;
    IF rr.backup_user_id IS NOT NULL
       AND NOT (rr.backup_user_id = ANY (t.declined_user_ids))
       AND user_eligible_for_category(p_enterprise_id, rr.backup_user_id, t.category_id, t.property_id)
    THEN
      backup_id := rr.backup_user_id;
    END IF;
    IF rr.manager_user_id IS NOT NULL THEN
      UPDATE tickets SET manager_user_id = rr.manager_user_id
      WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    END IF;
  END IF;

  IF primary_id IS NULL THEN
    SELECT u.id INTO primary_id
    FROM users u
    JOIN user_skills us ON us.enterprise_id = u.enterprise_id AND us.user_id = u.id
    WHERE u.enterprise_id = p_enterprise_id
      AND us.category_id = t.category_id
      AND u.status = 'active'
      AND u.availability IN ('Available', 'On call')
      AND (u.busy_until IS NULL OR u.busy_until <= now())
      AND (u.unavailable_until IS NULL OR u.unavailable_until <= now())
      AND NOT (u.id = ANY (t.declined_user_ids))
      AND user_covers_property(p_enterprise_id, u.id, t.property_id)
      AND (cap IS NULL OR u.open_ticket_count < cap)
    ORDER BY u.open_ticket_count ASC, u.last_assigned_at ASC NULLS FIRST
    FOR UPDATE OF u SKIP LOCKED
    LIMIT 1;
  END IF;

  IF primary_id IS NOT NULL AND backup_id IS NULL THEN
    SELECT u.id INTO backup_id
    FROM users u
    JOIN user_skills us ON us.enterprise_id = u.enterprise_id AND us.user_id = u.id
    WHERE u.enterprise_id = p_enterprise_id
      AND us.category_id = t.category_id
      AND u.status = 'active'
      AND u.availability IN ('Available', 'On call')
      AND (u.busy_until IS NULL OR u.busy_until <= now())
      AND u.id <> primary_id
      AND NOT (u.id = ANY (t.declined_user_ids))
      AND user_covers_property(p_enterprise_id, u.id, t.property_id)
      AND (cap IS NULL OR u.open_ticket_count < cap)
    ORDER BY u.open_ticket_count ASC, u.last_assigned_at ASC NULLS FIRST
    FOR UPDATE OF u SKIP LOCKED
    LIMIT 1;
  END IF;

  IF primary_id IS NULL THEN
    IF nf = 'unassign' THEN
      RETURN assign_level(p_enterprise_id, p_ticket_id, NULL, p_reason, from_id, NULL);
    ELSIF nf = 'notify_manager' THEN
      PERFORM enqueue_outbox(p_enterprise_id, 'notify',
        jsonb_build_object('ticket_id', p_ticket_id, 'event_type', 'nobody_free',
                           'manager_user_id', t.manager_user_id),
        'notify:nobody_free:' || p_ticket_id::text);
      RETURN assign_level(p_enterprise_id, p_ticket_id, NULL, p_reason, from_id, NULL);
    ELSE
      -- escalate
      PERFORM assign_level(p_enterprise_id, p_ticket_id, NULL, p_reason, from_id, NULL);
      PERFORM escalate_ticket(p_enterprise_id, p_ticket_id);
      RETURN NULL;
    END IF;
  END IF;

  RETURN assign_level(p_enterprise_id, p_ticket_id, primary_id, p_reason, from_id, backup_id);
END;
$$;

CREATE OR REPLACE FUNCTION escalate_ticket(
  p_enterprise_id uuid,
  p_ticket_id uuid
) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  next_level int;
  max_level int;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.status IN ('Resolved', 'Closed', 'Cancelled', 'Duplicate') THEN
    RAISE EXCEPTION 'cannot escalate from status %', t.status;
  END IF;
  IF t.chain_id IS NULL THEN
    RAISE EXCEPTION 'ticket has no escalation chain';
  END IF;
  IF t.escalation_state = 'exhausted' THEN
    RETURN COALESCE(t.current_level_no, 0);
  END IF;

  -- Anti-loop: same acker cannot immediately re-escalate without cooldown
  IF t.last_acked_by IS NOT NULL AND t.last_ack_at IS NOT NULL
     AND t.last_ack_at > now() - interval '2 minutes'
     AND t.escalation_state IN ('acked', 'none') THEN
    RAISE EXCEPTION 'ESCALATION_ANTI_LOOP: wait after acknowledge before re-escalating';
  END IF;

  SELECT COALESCE(MAX(level_no), 0) INTO max_level
  FROM escalation_levels
  WHERE enterprise_id = p_enterprise_id AND chain_id = t.chain_id;

  IF COALESCE(t.current_level_no, 0) >= max_level THEN
    UPDATE tickets SET escalation_state = 'exhausted', updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
    PERFORM clear_open_timers(p_enterprise_id, p_ticket_id,
      ARRAY['escalation_ack','level_respond','level_resolve']::timer_kind[]);
    PERFORM enqueue_outbox(p_enterprise_id, 'notify',
      jsonb_build_object('ticket_id', p_ticket_id, 'event_type', 'escalation_exhausted'),
      'notify:' || p_ticket_id::text || ':escalation_exhausted');
    PERFORM record_event(p_enterprise_id, p_ticket_id, 'escalation_exhausted', NULL,
      jsonb_build_object('level_no', t.current_level_no));
    RETURN COALESCE(t.current_level_no, 0);
  END IF;

  next_level := COALESCE(t.current_level_no, 0) + 1;
  next_level := severity_skip_level(p_enterprise_id, t.chain_id, t.severity, next_level);
  IF next_level > max_level THEN next_level := max_level; END IF;

  UPDATE tickets SET
    escalation_level = next_level,
    escalation_state = 'waiting',
    current_level_no = next_level,
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM enter_level(p_enterprise_id, p_ticket_id, next_level);
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'escalated', NULL,
    jsonb_build_object('level_no', next_level));
  RETURN next_level;
END;
$$;

CREATE OR REPLACE FUNCTION acknowledge_escalation(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  ok boolean;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;

  IF t.escalation_state <> 'waiting' THEN
    RAISE EXCEPTION 'ticket is not waiting on escalation';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM escalation_levels el
    JOIN escalation_level_roles elr ON elr.enterprise_id = el.enterprise_id AND elr.level_id = el.id
    JOIN users u ON u.enterprise_id = elr.enterprise_id AND u.role_id = elr.role_id
    WHERE el.enterprise_id = p_enterprise_id
      AND el.chain_id = t.chain_id
      AND el.level_no = t.current_level_no
      AND u.id = p_user_id
  ) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'user is not in the current escalation level role pool';
  END IF;

  UPDATE ticket_levels SET
    acknowledged_at = now(),
    acknowledged_by = p_user_id
  WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id AND left_at IS NULL;

  PERFORM clear_open_timers(p_enterprise_id, p_ticket_id, ARRAY['escalation_ack']::timer_kind[]);

  UPDATE tickets SET
    escalation_state = 'acked',
    last_acked_by = p_user_id,
    last_ack_at = now(),
    declined_user_ids = '{}',
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM record_event(p_enterprise_id, p_ticket_id, 'escalation_acked', p_user_id,
    jsonb_build_object('anti_loop', true));
  PERFORM enter_level(p_enterprise_id, p_ticket_id, 0);
  UPDATE tickets SET escalation_state = 'none', updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
  PERFORM pick_and_assign(p_enterprise_id, p_ticket_id, 'escalate_ack');
END;
$$;

CREATE OR REPLACE FUNCTION create_ticket(
  p_enterprise_id uuid,
  p_property_id uuid,
  p_unit_id uuid,
  p_tenant_id uuid,
  p_lease_id uuid,
  p_category_id uuid,
  p_channel text,
  p_subject text,
  p_notes text,
  p_priority priority_code DEFAULT 'Normal',
  p_actor uuid DEFAULT NULL,
  p_is_imported boolean DEFAULT false,
  p_import_status ticket_status DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_num text;
  v_chain escalation_chains%ROWTYPE;
  v_status ticket_status;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  PERFORM assert_licence_active(p_enterprise_id);

  IF NOT EXISTS (SELECT 1 FROM enterprise_settings WHERE enterprise_id = p_enterprise_id) THEN
    RAISE EXCEPTION 'enterprise_settings missing for %', p_enterprise_id;
  END IF;

  v_chain := resolve_chain(p_enterprise_id, p_category_id, p_property_id);
  v_num := next_ticket_number(p_enterprise_id);
  v_status := COALESCE(p_import_status, 'Open'::ticket_status);

  INSERT INTO tickets (
    enterprise_id, ticket_number, property_id, unit_id, tenant_id, lease_id,
    category_id, channel, subject, priority, status, chain_id, is_imported,
    clock_started_at
  ) VALUES (
    p_enterprise_id, v_num, p_property_id, p_unit_id, p_tenant_id, p_lease_id,
    p_category_id, p_channel, p_subject, p_priority, v_status,
    v_chain.id, p_is_imported,
    CASE WHEN p_is_imported AND v_status IN ('Resolved','Closed') THEN NULL ELSE now() END
  ) RETURNING id INTO v_id;

  IF p_notes IS NOT NULL AND length(trim(p_notes)) > 0 THEN
    INSERT INTO ticket_comments (enterprise_id, ticket_id, author_user_id, visibility, body)
    VALUES (p_enterprise_id, v_id, p_actor, 'internal', p_notes);
  END IF;

  PERFORM record_event(p_enterprise_id, v_id, 'created', p_actor, jsonb_build_object('number', v_num));
  PERFORM enqueue_outbox(p_enterprise_id, 'ai_enrich',
    jsonb_build_object('ticket_id', v_id), 'ai_enrich:' || v_id::text);

  IF NOT (p_is_imported AND v_status IN ('Resolved','Closed')) THEN
    PERFORM enter_level(p_enterprise_id, v_id, 0);
    PERFORM apply_ticket_policy(p_enterprise_id, v_id);
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION change_ticket_classification(
  p_enterprise_id uuid,
  p_ticket_id uuid,
  p_category_id uuid DEFAULT NULL,
  p_priority priority_code DEFAULT NULL,
  p_actor uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t tickets%ROWTYPE;
  before jsonb;
  v_cat uuid;
  v_chain escalation_chains%ROWTYPE;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id FOR UPDATE;
  before := jsonb_build_object('category_id', t.category_id, 'priority', t.priority);
  v_cat := COALESCE(p_category_id, t.category_id);
  v_chain := resolve_chain(p_enterprise_id, v_cat, t.property_id);

  UPDATE tickets SET
    category_id = v_cat,
    priority = COALESCE(p_priority, priority),
    chain_id = COALESCE(v_chain.id, chain_id),
    clock_started_at = now(),
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;

  PERFORM apply_ticket_policy(p_enterprise_id, p_ticket_id);
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'classification_changed', p_actor,
    jsonb_build_object('before', before, 'category_id', v_cat,
                       'priority', COALESCE(p_priority, t.priority)));
  INSERT INTO audit_log (enterprise_id, actor_user_id, entity_type, entity_id, action, before_state, after_state)
  VALUES (p_enterprise_id, p_actor, 'ticket', p_ticket_id, 'classification_changed', before,
    jsonb_build_object('category_id', v_cat, 'priority', COALESCE(p_priority, t.priority)));
END;
$$;

CREATE OR REPLACE FUNCTION apply_ai_prediction(
  p_enterprise_id uuid,
  p_prediction_id uuid,
  p_actor uuid DEFAULT NULL,
  p_confirm boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  pred ai_predictions%ROWTYPE;
  t tickets%ROWTYPE;
  settings enterprise_settings%ROWTYPE;
  new_pri priority_code;
  apply_cat uuid;
  leaf boolean;
  v_chain escalation_chains%ROWTYPE;
  v_cat uuid;
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO pred FROM ai_predictions
  WHERE enterprise_id = p_enterprise_id AND id = p_prediction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prediction not found'; END IF;
  SELECT * INTO t FROM tickets
  WHERE enterprise_id = p_enterprise_id AND id = pred.ticket_id FOR UPDATE;
  SELECT * INTO settings FROM enterprise_settings WHERE enterprise_id = p_enterprise_id;

  apply_cat := COALESCE(pred.corrected_category_id, pred.category_id);
  new_pri := COALESCE(pred.corrected_priority, pred.predicted_priority, t.priority);

  IF apply_cat IS NOT NULL THEN
    leaf := category_is_leaf(p_enterprise_id, apply_cat);
    IF NOT leaf THEN
      UPDATE ai_predictions SET needs_triage = true WHERE enterprise_id = p_enterprise_id AND id = p_prediction_id;
      UPDATE tickets SET needs_triage = true, updated_at = now()
      WHERE enterprise_id = p_enterprise_id AND id = t.id;
      PERFORM record_event(p_enterprise_id, t.id, 'ai_non_leaf_triage', p_actor,
        jsonb_build_object('category_id', apply_cat));
      RETURN;
    END IF;
  END IF;

  IF pred.routing_mode = 'human_review' AND NOT p_confirm THEN
    UPDATE tickets SET needs_triage = true, updated_at = now()
    WHERE enterprise_id = p_enterprise_id AND id = t.id;
    UPDATE ai_predictions SET needs_triage = true WHERE enterprise_id = p_enterprise_id AND id = p_prediction_id;
    RETURN;
  END IF;

  IF pred.routing_mode = 'auto' AND NOT p_confirm THEN
    IF pred.confidence IS NULL OR pred.confidence < settings.ai_confidence_threshold THEN
      UPDATE tickets SET needs_triage = true, updated_at = now()
      WHERE enterprise_id = p_enterprise_id AND id = t.id;
      UPDATE ai_predictions SET needs_triage = true WHERE enterprise_id = p_enterprise_id AND id = p_prediction_id;
      RETURN;
    END IF;
  END IF;

  new_pri := cap_priority_raise(t.priority, new_pri, settings.ai_priority_raise_cap);

  IF new_pri IS DISTINCT FROM t.priority THEN
    PERFORM record_event(p_enterprise_id, t.id, 'ai_priority_changed', p_actor,
      jsonb_build_object('from', t.priority, 'to', new_pri, 'prediction_id', p_prediction_id));
  END IF;

  v_cat := COALESCE(apply_cat, t.category_id);
  v_chain := resolve_chain(p_enterprise_id, v_cat, t.property_id);
  UPDATE tickets SET
    category_id = v_cat,
    priority = new_pri,
    chain_id = COALESCE(v_chain.id, chain_id),
    needs_triage = false,
    ai_confidence = pred.confidence,
    sentiment_label = COALESCE(pred.corrected_sentiment, pred.sentiment_label, sentiment_label),
    sentiment_score = COALESCE(pred.sentiment_score, sentiment_score),
    updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = t.id;

  UPDATE ai_predictions SET needs_triage = false
  WHERE enterprise_id = p_enterprise_id AND id = p_prediction_id;

  PERFORM apply_ticket_policy(p_enterprise_id, t.id);
  PERFORM pick_and_assign(p_enterprise_id, t.id, 'initial_route');
END;
$$;

CREATE OR REPLACE FUNCTION ai_enrich_timeout(
  p_enterprise_id uuid,
  p_ticket_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  UPDATE tickets SET needs_triage = true, updated_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_ticket_id;
  UPDATE ai_predictions SET timed_out = true, needs_triage = true
  WHERE enterprise_id = p_enterprise_id AND ticket_id = p_ticket_id
    AND corrected_at IS NULL;
  PERFORM record_event(p_enterprise_id, p_ticket_id, 'ai_timeout_triage', NULL, '{}');
END;
$$;

CREATE OR REPLACE FUNCTION handle_busy_until(
  p_enterprise_id uuid,
  p_user_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  UPDATE users SET
    availability = 'Available',
    busy_until = NULL,
    unavailable_until = NULL
  WHERE enterprise_id = p_enterprise_id AND id = p_user_id
    AND (busy_until IS NULL OR busy_until <= now());
END;
$$;

CREATE OR REPLACE FUNCTION act_and_consume_timer(
  p_enterprise_id uuid,
  p_timer_id uuid
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  tm ticket_timers%ROWTYPE;
  t tickets%ROWTYPE;
  action text := 'noop';
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);
  SELECT * INTO tm FROM ticket_timers
  WHERE enterprise_id = p_enterprise_id AND id = p_timer_id
    AND consumed_at IS NULL AND cancelled_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'already_done'; END IF;

  IF tm.kind = 'busy_until' THEN
    PERFORM handle_busy_until(p_enterprise_id, COALESCE(tm.user_id, (tm.payload->>'user_id')::uuid));
    action := 'busy_restored';
  ELSIF tm.kind = 'tenant_respond' THEN
    SELECT * INTO t FROM tickets WHERE enterprise_id = p_enterprise_id AND id = tm.ticket_id FOR UPDATE;
    IF t.first_response_at IS NULL AND t.respond_breached_at IS NULL
       AND t.status NOT IN ('Resolved','Closed','Cancelled','Duplicate','On Hold') THEN
      UPDATE tickets SET respond_breached_at = now(), updated_at = now()
      WHERE enterprise_id = p_enterprise_id AND id = tm.ticket_id;
      PERFORM record_event(p_enterprise_id, tm.ticket_id, 'sla_breached', NULL,
        jsonb_build_object('window', 'respond', 'timer_id', tm.id));
      action := 'respond_breached';
    ELSE
      action := 'respond_skip';
    END IF;
  ELSIF tm.kind = 'tenant_resolve' THEN
    SELECT * INTO t FROM tickets WHERE enterprise_id = p_enterprise_id AND id = tm.ticket_id FOR UPDATE;
    IF t.resolved_at IS NULL AND t.resolve_breached_at IS NULL
       AND t.status NOT IN ('Resolved','Closed','Cancelled','Duplicate','On Hold') THEN
      UPDATE tickets SET resolve_breached_at = now(), updated_at = now()
      WHERE enterprise_id = p_enterprise_id AND id = tm.ticket_id;
      PERFORM record_event(p_enterprise_id, tm.ticket_id, 'sla_breached', NULL,
        jsonb_build_object('window', 'resolve', 'timer_id', tm.id));
      action := 'resolve_breached';
    ELSE
      action := 'resolve_skip';
    END IF;
  ELSIF tm.kind = 'at_risk' THEN
    PERFORM record_event(p_enterprise_id, tm.ticket_id, 'sla_at_risk', NULL, tm.payload || jsonb_build_object('timer_id', tm.id));
    action := 'at_risk';
  ELSIF tm.kind = 'escalation_ack' THEN
    SELECT * INTO t FROM tickets WHERE enterprise_id = p_enterprise_id AND id = tm.ticket_id FOR UPDATE;
    IF t.escalation_state = 'waiting' THEN
      PERFORM escalate_ticket(p_enterprise_id, tm.ticket_id);
      action := 'ack_timeout_escalate';
    ELSE
      action := 'ack_skip';
    END IF;
  ELSIF tm.kind = 'auto_close' THEN
    SELECT * INTO t FROM tickets WHERE enterprise_id = p_enterprise_id AND id = tm.ticket_id FOR UPDATE;
    IF t.status = 'Resolved' THEN
      PERFORM close_ticket(p_enterprise_id, tm.ticket_id);
      action := 'auto_closed';
    ELSE
      action := 'auto_close_skip';
    END IF;
  ELSE
    action := 'unhandled_' || tm.kind::text;
  END IF;

  UPDATE ticket_timers SET consumed_at = now()
  WHERE enterprise_id = p_enterprise_id AND id = p_timer_id
    AND consumed_at IS NULL AND cancelled_at IS NULL;
  RETURN action;
END;
$$;

CREATE OR REPLACE FUNCTION consume_timer(p_enterprise_id uuid, p_timer_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM act_and_consume_timer(p_enterprise_id, p_timer_id);
END;
$$;

CREATE OR REPLACE FUNCTION anonymise_tenant(
  p_enterprise_id uuid,
  p_tenant_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  tok text := 'anon_' || substr(replace(p_tenant_id::text, '-', ''), 1, 12);
BEGIN
  PERFORM assert_enterprise(p_enterprise_id);

  UPDATE tenants SET
    full_name = tok,
    email = tok || '@anonymised.invalid',
    phone = NULL,
    sentiment_label = NULL,
    sentiment_score = NULL
  WHERE enterprise_id = p_enterprise_id AND id = p_tenant_id;

  UPDATE ticket_comments SET body = '[redacted]'
  WHERE enterprise_id = p_enterprise_id
    AND ticket_id IN (SELECT id FROM tickets WHERE enterprise_id = p_enterprise_id AND tenant_id = p_tenant_id)
    AND visibility = 'tenant';

  UPDATE notifications SET body = NULL, title = 'Notification'
  WHERE enterprise_id = p_enterprise_id
    AND ticket_id IN (SELECT id FROM tickets WHERE enterprise_id = p_enterprise_id AND tenant_id = p_tenant_id);

  -- Retain audit trail with redacted marker (append-only insert)
  INSERT INTO audit_log (enterprise_id, entity_type, entity_id, action, after_state)
  VALUES (p_enterprise_id, 'tenant', p_tenant_id, 'anonymised',
    jsonb_build_object('token', tok));
END;
$$;

-- App roles / grants
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'propdesk_app') THEN
    CREATE ROLE propdesk_app NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'propdesk_readonly') THEN
    CREATE ROLE propdesk_readonly NOINHERIT;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO propdesk_app, propdesk_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO propdesk_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO propdesk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO propdesk_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO propdesk_app, propdesk_readonly;

REVOKE UPDATE, DELETE ON ticket_events FROM propdesk_app;
REVOKE UPDATE, DELETE ON audit_log FROM propdesk_app;
GRANT SELECT, INSERT ON ticket_events TO propdesk_app;
GRANT SELECT, INSERT ON audit_log TO propdesk_app;

-- Pin DEFINER + search_path for closeout functions
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'assert_licence_active','priority_rank','priority_from_rank','cap_priority_raise',
        'category_is_leaf','resolve_chain','tickets_cross_column_check','fanout_level_notify',
        'apply_severity_window_factor','severity_skip_level','enter_level','pick_and_assign',
        'escalate_ticket','acknowledge_escalation','create_ticket','change_ticket_classification',
        'apply_ai_prediction','ai_enrich_timeout','handle_busy_until','act_and_consume_timer',
        'consume_timer','anonymise_tenant','enqueue_outbox'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I(%s) SECURITY DEFINER SET search_path = public',
      r.proname, r.args
    );
  END LOOP;
END;
$$;


COMMIT;
