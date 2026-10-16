"use client";

import { useState, type ReactNode } from "react";
import { EnterpriseProvider, AdminPage, SlaPolicies, EscalationBuilder, NextAvailablePanel, EntTabs } from "./Enterprise";

type Tone = "blue" | "green" | "amber" | "red" | "purple" | "teal" | "slate";

type Ticket = {
  id: string;
  tenant: string;
  property: string;
  unit: string;
  category: string;
  priority: string;
  sentiment: string;
  staff: string;
  sla: string;
  status: string;
};

const tickets: Ticket[] = [
  { id: "HD-24891", tenant: "Maya Patel", property: "The Foundry", unit: "4B", category: "Heating", priority: "Urgent", sentiment: "Negative", staff: "Dana Hughes", sla: "00:42", status: "In Progress" },
  { id: "HD-24890", tenant: "Leon Brooks", property: "Harbour Court", unit: "12A", category: "Access", priority: "High", sentiment: "Negative", staff: "Marcus Lee", sla: "01:18", status: "Open" },
  { id: "HD-24887", tenant: "Sofia Almeida", property: "Arcadia House", unit: "7C", category: "Plumbing", priority: "Normal", sentiment: "Neutral", staff: "Priya Shah", sla: "03:44", status: "In Progress" },
  { id: "HD-24884", tenant: "Noah Williams", property: "The Foundry", unit: "2F", category: "Electrical", priority: "High", sentiment: "Positive", staff: "Dana Hughes", sla: "Breached 16m", status: "Escalated" },
  { id: "HD-24880", tenant: "Amelia Chen", property: "Quayside Place", unit: "18D", category: "Noise", priority: "Normal", sentiment: "Neutral", staff: "Unassigned", sla: "05:12", status: "Open" },
  { id: "HD-24876", tenant: "Oliver Grant", property: "Harbour Court", unit: "9E", category: "Lift", priority: "High", sentiment: "Negative", staff: "Marcus Lee", sla: "At risk 22m", status: "In Progress" },
];

const navItems = [
  ["dashboard", "Dashboard", "grid"],
  ["tickets", "Tickets", "ticket"],
  ["my-queue", "My Queue", "inbox"],
  ["team-queue", "Team Queue", "users"],
  ["properties", "Properties", "building"],
  ["tenants", "Tenants", "person"],
  ["routing", "Staff & Routing", "route"],
  ["sla", "SLA & Escalations", "clock"],
  ["ai", "AI & Sentiment", "spark"],
  ["reports", "Reports", "chart"],
  ["migration", "Data Migration", "upload"],
  ["admin", "Administration", "settings"],
];

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
    ticket: <><path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6V5Z" /><path d="M13 5v14" /></>,
    inbox: <><path d="M4 5h16v13H4z" /><path d="M4 13h5l2 3h2l2-3h5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 19c0-4 2-6 6-6s6 2 6 6" /><path d="M16 5a3 3 0 0 1 0 6m1 3c3 .4 4 2 4 5" /></>,
    building: <><path d="M5 21V3h11v18M8 7h2m3 0h1M8 11h2m3 0h1M8 15h2m3 0h1M3 21h18" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-5 3-8 8-8s8 3 8 8" /></>,
    route: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h4a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H8a2 2 0 0 0 0 4h8" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
    spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></>,
    chart: <><path d="M4 20V10m6 10V4m6 16v-7m4 7H2" /></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 15v5h16v-5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7-.8-1.9.9-1.9L15 3.9l-1.9.9-1.9-.8-.7-2h-3l-.7 2-1.9.8L3 3.9.9 6l.9 1.9L1 9.8l-2 .7v3l2 .7.8 1.9-.9 1.9L3 20.1l1.9-.9 1.9.8.7 2h3l.7-2 1.9-.8 1.9.9 2.1-2.1-.9-1.9.8-1.9 2-.7Z" transform="translate(2)" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    bell: <><path d="M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5L6 17Z" /><path d="M10 20h4" /></>,
    filter: <><path d="M4 6h16M7 12h10m-7 6h4" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6m-6 4h6" /></>,
    download: <><path d="M12 4v12m0 0 5-5m-5 5-5-5" /><path d="M4 20h16" /></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>;
}

function Button({ children, variant = "secondary", icon, onClick }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "purple"; icon?: string; onClick?: () => void }) {
  return <div className={`button ${variant}`} role="button" tabIndex={0} onClick={onClick}>{icon && <Icon name={icon} />}{children}</div>;
}

function Badge({ children, tone = "slate", dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="status-dot" />}{children}</span>;
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="panel-header"><div><div className="panel-title">{title}</div>{subtitle && <div className="panel-subtitle">{subtitle}</div>}</div>{action}</div>;
}

function Field({ label, value, hint, wide = false }: { label: string; value: string; hint?: string; wide?: boolean }) {
  return <div className={`field-wrap ${wide ? "field-wide" : ""}`}><div className="field-label">{label}</div><div className="field">{value}<Icon name="chevron" size={13} /></div>{hint && <div className="field-hint">{hint}</div>}</div>;
}

function SourceKey() {
  return <div className="source-key">
    <span><i className="key-dot crm" />CRM Data</span><span><i className="key-dot ai" />AI Generated</span><span><i className="key-dot system" />System Generated</span><span><i className="key-dot staff" />Staff Action</span><span><i className="key-dot manager" />Manager Action</span>
  </div>;
}

function Header({ title, subtitle, onCreate }: { title: string; subtitle: string; onCreate: () => void }) {
  return <header className="topbar">
    <div><div className="eyebrow">OPERATIONS / {title.toUpperCase()}</div><div className="page-title">{title}</div><div className="page-subtitle">{subtitle}</div></div>
    <div className="header-actions">
      <div className="global-search"><Icon name="search" /><span>Search tickets, tenants, properties</span><kbd>⌘ K</kbd></div>
      <div className="icon-button" role="button"><Icon name="bell" /><span className="notification-dot" /></div>
      <Button variant="primary" icon="plus" onClick={onCreate}>Create ticket</Button>
    </div>
  </header>;
}

function MetricCard({ label, value, delta, tone, detail }: { label: string; value: string; delta: string; tone: Tone; detail: string }) {
  return <Panel className={`metric metric-${tone}`}>
    <div className="metric-top"><span>{label}</span><span className={`metric-mark ${tone}`} /></div>
    <div className="metric-value">{value}</div>
    <div className="metric-meta"><strong>{delta}</strong><span>{detail}</span></div>
  </Panel>;
}

function Dashboard() {
  return <div className="page-content">
    <div className="metrics-grid">
      <MetricCard label="Open tickets" value="128" delta="+12" detail="since yesterday" tone="blue" />
      <MetricCard label="In progress" value="74" delta="58%" detail="of open workload" tone="teal" />
      <MetricCard label="SLA at risk" value="18" delta="+4" detail="in the last hour" tone="amber" />
      <MetricCard label="SLA breached" value="7" delta="−2" detail="vs. yesterday" tone="red" />
      <MetricCard label="Escalated" value="11" delta="3 new" detail="awaiting manager" tone="purple" />
      <MetricCard label="Negative sentiment" value="23%" delta="+3.2%" detail="7-day variance" tone="red" />
    </div>
    <div className="dashboard-main">
      <Panel className="trend-panel">
        <PanelHeader title="Ticket volume" subtitle="Created vs resolved · Last 7 days" action={<div className="segmented"><span className="active">7D</span><span>30D</span><span>90D</span></div>} />
        <div className="chart-legend"><span><i className="line-key blue" />Created</span><span><i className="line-key teal" />Resolved</span><strong>312 total</strong></div>
        <div className="line-chart">
          <div className="y-labels"><span>60</span><span>40</span><span>20</span><span>0</span></div>
          <svg viewBox="0 0 680 180" preserveAspectRatio="none">
            <g className="grid-lines"><path d="M0 20H680M0 70H680M0 120H680M0 170H680" /></g>
            <path className="area created-area" d="M0 126 L105 92 L215 108 L325 55 L435 80 L545 42 L680 64 L680 170 L0 170Z" />
            <path className="chart-line created" d="M0 126 L105 92 L215 108 L325 55 L435 80 L545 42 L680 64" />
            <path className="chart-line resolved" d="M0 140 L105 118 L215 95 L325 110 L435 74 L545 89 L680 54" />
            <g className="points"><circle cx="545" cy="42" r="4" /><circle cx="680" cy="64" r="4" /></g>
          </svg>
          <div className="x-labels"><span>Mon 08</span><span>Tue 09</span><span>Wed 10</span><span>Thu 11</span><span>Fri 12</span><span>Sat 13</span><span>Sun 14</span></div>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="SLA health" subtitle="All active tickets" action={<span className="text-link">View details</span>} />
        <div className="donut-row">
          <div className="donut"><div><strong>202</strong><span>Active</span></div></div>
          <div className="donut-legend">
            <div><span><i className="key-dot success" />Within SLA</span><strong>177 <small>87.6%</small></strong></div>
            <div><span><i className="key-dot warning" />At risk</span><strong>18 <small>8.9%</small></strong></div>
            <div><span><i className="key-dot danger" />Breached</span><strong>7 <small>3.5%</small></strong></div>
          </div>
        </div>
        <div className="sla-note"><Icon name="clock" /><span><strong>7 tickets require action</strong><br />Next breach in 00:18:42</span></div>
      </Panel>
    </div>
    <div className="dashboard-lower">
      <Panel>
        <PanelHeader title="Sentiment breakdown" subtitle="AI analysis · Last 30 days" action={<Badge tone="purple">AI generated</Badge>} />
        <div className="sentiment-bars">
          <div><span>Positive</span><div><i className="positive" style={{ width: "31%" }} /></div><strong>31%</strong></div>
          <div><span>Neutral</span><div><i className="neutral" style={{ width: "46%" }} /></div><strong>46%</strong></div>
          <div><span>Negative</span><div><i className="negative" style={{ width: "23%" }} /></div><strong>23%</strong></div>
        </div>
        <div className="insight"><span className="ai-icon"><Icon name="spark" /></span><span><strong>AI insight</strong>Negative sentiment rose 8% for heating tickets at The Foundry.</span></div>
      </Panel>
      <Panel className="property-panel">
        <PanelHeader title="Property comparison" subtitle="Operational performance · This month" action={<span className="text-link">View all properties</span>} />
        <div className="data-table compact">
          <div className="table-row table-head"><span>Property</span><span>Open</span><span>SLA</span><span>Sentiment</span><span>Avg. resolve</span></div>
          {[["The Foundry","38","82.1%","−18","9.4h"],["Harbour Court","27","91.4%","+4","6.2h"],["Arcadia House","21","94.8%","+11","4.8h"],["Quayside Place","18","96.2%","+8","4.1h"]].map((r, i) =>
            <div className="table-row" key={r[0]}><span><span className="property-avatar">{r[0].charAt(0)}</span>{r[0]}</span><strong>{r[1]}</strong><span className={i === 0 ? "danger-text" : "success-text"}>{r[2]}</span><Badge tone={i === 0 ? "red" : i === 1 ? "slate" : "green"}>{r[3]}</Badge><span>{r[4]}</span></div>)}
        </div>
      </Panel>
    </div>
  </div>;
}

function Queue({ onTicket }: { onTicket: () => void }) {
  return <div className="page-content">
    <div className="toolbar-panel">
      <div className="queue-tabs"><span className="active">All tickets <b>128</b></span><span>Unassigned <b>14</b></span><span>My tickets <b>19</b></span><span>Escalated <b>11</b></span></div>
      <div className="toolbar-row">
        <div className="table-search"><Icon name="search" />Search by ticket, tenant or property</div>
        <Button icon="filter">Filters <Badge tone="blue">3</Badge></Button>
        <Field label="" value="Updated: newest" />
      </div>
      <div className="active-filters"><span>Status: Open <b>×</b></span><span>Priority: High + Urgent <b>×</b></span><span>SLA: At risk <b>×</b></span><strong>Clear all</strong></div>
    </div>
    <Panel className="table-panel">
      <div className="ticket-table">
        <div className="ticket-row ticket-head"><span>Ticket ID</span><span>Tenant / Property</span><span>Unit</span><span>Category</span><span>Priority</span><span>Sentiment</span><span>Assigned staff</span><span>SLA</span><span>Status</span><span /></div>
        {tickets.map((t) => <div className="ticket-row clickable" key={t.id} onClick={onTicket}>
          <span><strong className="ticket-id">{t.id}</strong><small>Today, 10:{t.id.slice(-2)}</small></span>
          <span><strong>{t.tenant}</strong><small>{t.property}</small></span><span>{t.unit}</span><span>{t.category}</span>
          <span><Badge tone={t.priority === "Urgent" ? "red" : t.priority === "High" ? "amber" : "slate"}>{t.priority}</Badge></span>
          <span><Badge tone={t.sentiment === "Negative" ? "red" : t.sentiment === "Positive" ? "green" : "slate"} dot>{t.sentiment}</Badge></span>
          <span className="staff-cell"><i>{t.staff.split(" ").map(n => n[0]).join("").slice(0,2)}</i>{t.staff}</span>
          <span className={t.sla.includes("Breached") ? "danger-text" : t.sla.includes("risk") || t.sla === "00:42" ? "warning-text" : ""}><strong>{t.sla}</strong></span>
          <span><Badge tone={t.status === "Escalated" ? "red" : t.status === "In Progress" ? "blue" : "slate"}>{t.status}</Badge></span><span><Icon name="more" /></span>
        </div>)}
      </div>
      <div className="pagination"><span>Showing 1–6 of 128 tickets</span><div><Button>Previous</Button><span className="page-number">1</span><span>2</span><span>3</span><span>…</span><span>22</span><Button>Next</Button></div></div>
    </Panel>
  </div>;
}

function CreateTicket({ onCancel }: { onCancel: () => void }) {
  return <div className="page-content create-layout">
    <div className="create-main">
      <Panel>
        <PanelHeader title="Tenant & lease" subtitle="Search CRM records to auto-link tenancy data" action={<Badge tone="blue">CRM data</Badge>} />
        <div className="tenant-search"><Icon name="search" /><span>Maya Patel</span><Badge tone="green"><Icon name="check" size={12} />Active tenant found</Badge></div>
        <div className="linked-record"><div className="avatar-large">MP</div><div><strong>Maya Patel</strong><span>maya.patel@example.com · +44 7700 900421</span></div><div className="record-meta"><span><small>PROPERTY</small>The Foundry</span><span><small>UNIT</small>4B</span><span><small>LEASE</small>L-10482 · Active</span></div></div>
      </Panel>
      <Panel>
        <PanelHeader title="Call details" subtitle="Capture the tenant's issue and contact context" />
        <div className="form-grid"><Field label="Contact channel" value="Inbound call" /><Field label="Contact number" value="+44 7700 900421" /><Field label="Reported at" value="14 Jan 2025, 10:42" /><Field label="Callback required" value="Yes — today" /></div>
        <div className="notes-field"><div className="field-label">Call notes</div><div className="textarea">Tenant reports the boiler stopped working overnight. The flat is currently 14°C and there is a young child in the property. Restart procedure was attempted without success.</div><div className="notes-footer"><span>275 characters</span><span>Autosaved 10:44</span></div></div>
      </Panel>
      <Panel>
        <PanelHeader title="Allocation" subtitle="Routing based on property, category and current staff availability" action={<Badge tone="teal">System generated</Badge>} />
        <div className="route-flow"><div><small>PROPERTY</small><strong>The Foundry</strong></div><Icon name="chevron" /><div><small>CATEGORY</small><strong>Heating</strong></div><Icon name="chevron" /><div className="selected-route"><small>PRIMARY</small><strong>Dana Hughes</strong><span>Available · 6 open</span></div><Icon name="chevron" /><div><small>BACKUP</small><strong>Marcus Lee</strong><span>Available · 8 open</span></div></div>
      </Panel>
    </div>
    <div className="create-side">
      <Panel className="ai-analysis">
        <PanelHeader title="AI analysis" subtitle="Generated from call notes" action={<Badge tone="purple"><Icon name="spark" size={12} />AI</Badge>} />
        <div className="analysis-status"><span className="ai-icon"><Icon name="spark" /></span><span><strong>Analysis complete</strong>Model confidence: 94%</span></div>
        <div className="analysis-item"><small>DETECTED CATEGORY</small><strong>Heating / Boiler failure</strong><span>Confidence 97%</span></div>
        <div className="analysis-item"><small>SENTIMENT</small><strong className="danger-text">Negative · −0.72</strong><span>Confidence 91%</span></div>
        <div className="analysis-item"><small>URGENCY SIGNALS</small><div className="tag-list"><Badge tone="red">No heating</Badge><Badge tone="amber">Child present</Badge><Badge tone="amber">Low temperature</Badge></div></div>
        <div className="recommendation"><strong>Recommended priority: Urgent</strong><span>Potential vulnerable household with complete loss of heating.</span></div>
      </Panel>
      <Panel>
        <PanelHeader title="Ticket settings" />
        <Field label="Priority" value="Urgent" />
        <Field label="Initial status" value="Open" />
        <Field label="SLA policy" value="Emergency repair · 2h" />
        <div className="sla-preview"><span>FIRST RESPONSE DUE</span><strong>Today, 12:42</strong><small>1h 58m remaining</small></div>
      </Panel>
      <div className="form-actions"><Button onClick={onCancel}>Cancel</Button><Button variant="primary" icon="plus">Create & assign ticket</Button></div>
    </div>
  </div>;
}

function TicketDetail({ onBack }: { onBack: () => void }) {
  const timeline = [
    ["10:52", "Staff action", "Dana Hughes accepted assignment", "staff"],
    ["10:47", "System generated", "SLA changed to At Risk based on urgency policy", "system"],
    ["10:46", "AI generated", "Category and sentiment analysis completed", "ai"],
    ["10:42", "CRM data", "Ticket created from inbound tenant call", "crm"],
  ];
  return <div className="page-content">
    <div className="detail-toolbar"><span className="back-link" onClick={onBack}>‹ All tickets</span><div><Button icon="route">Reassign</Button><Button variant="danger">Escalate</Button><Button>Add note</Button><Button variant="primary"><Icon name="check" />Resolve</Button></div></div>
    <div className="ticket-summary">
      <div><div className="ticket-kicker">HD-24891 · CREATED TODAY AT 10:42</div><div className="detail-title">No heating — boiler failure</div><div className="detail-subtitle">Maya Patel · The Foundry, Unit 4B · Inbound call</div></div>
      <div className="summary-badges"><Badge tone="blue" dot>In Progress</Badge><Badge tone="red">Urgent</Badge><Badge tone="red" dot>Negative</Badge></div>
    </div>
    <div className="detail-grid">
      <div className="detail-main">
        <Panel>
          <PanelHeader title="Issue notes" action={<Badge tone="slate">Staff action</Badge>} />
          <p className="body-copy">Tenant reports the boiler stopped working overnight. The flat is currently 14°C and there is a young child in the property. Restart procedure was attempted without success.</p>
          <div className="note-meta"><span className="avatar-small">OP</span><span><strong>Olivia Price</strong><small>Helpdesk coordinator · 10:42</small></span><span className="text-link">Edit note</span></div>
        </Panel>
        <Panel>
          <PanelHeader title="Activity timeline" subtitle="Complete audit trail" />
          <div className="timeline">{timeline.map((e) => <div className="timeline-item" key={e[0]}><span className={`timeline-dot ${e[3]}`} /><span className="timeline-time">{e[0]}</span><span><Badge tone={e[3] === "ai" ? "purple" : e[3] === "staff" ? "blue" : e[3] === "system" ? "teal" : "slate"}>{e[1]}</Badge><strong>{e[2]}</strong><small>14 Jan 2025</small></span></div>)}</div>
          <div className="add-note"><div className="textarea">Add an internal note or update…</div><div><span>Visible to staff only</span><Button variant="primary">Add note</Button></div></div>
        </Panel>
      </div>
      <div className="detail-side">
        <Panel className="sla-card">
          <PanelHeader title="SLA timer" action={<Badge tone="amber">At risk</Badge>} />
          <div className="timer">00:42:18</div><div className="timer-caption">until response breach · Due 12:42</div>
          <div className="progress"><i /></div><div className="timer-meta"><span>78% elapsed</span><span>Emergency repair · 2h</span></div>
        </Panel>
        <Panel>
          <PanelHeader title="AI enrichment" action={<Badge tone="purple"><Icon name="spark" size={12} />94% confidence</Badge>} />
          <div className="info-list"><span><small>CATEGORY</small><strong>Heating / Boiler failure</strong></span><span><small>SENTIMENT</small><strong className="danger-text">Negative · −0.72</strong></span><span><small>URGENCY</small><strong>High confidence</strong></span></div>
          <div className="tag-list"><Badge tone="red">No heating</Badge><Badge tone="amber">Child present</Badge><Badge tone="amber">14°C</Badge></div>
        </Panel>
        <Panel>
          <PanelHeader title="Allocation" action={<Badge tone="teal">Auto-routed</Badge>} />
          <div className="assignee"><span className="avatar-large small">DH</span><span><small>PRIMARY ASSIGNEE</small><strong>Dana Hughes</strong><em><i />Available · 6 open</em></span></div>
          <div className="backup"><span>Backup</span><strong>Marcus Lee</strong><span>Manager</span><strong>Ruth Allen</strong></div>
        </Panel>
        <Panel>
          <PanelHeader title="Linked CRM records" />
          <div className="linked-list"><span><Icon name="person" /><i><strong>Maya Patel</strong><small>Tenant · Active</small></i><Icon name="chevron" /></span><span><Icon name="building" /><i><strong>The Foundry · 4B</strong><small>Property & unit</small></i><Icon name="chevron" /></span><span><Icon name="file" /><i><strong>L-10482</strong><small>Lease · Ends 30 Sep 2025</small></i><Icon name="chevron" /></span></div>
        </Panel>
      </div>
    </div>
  </div>;
}

function Routing() {
  const staff = [["Dana Hughes","Maintenance","Available","6","92%"],["Marcus Lee","Maintenance","Available","8","89%"],["Priya Shah","Resident services","On call","4","96%"],["Alex Morgan","Compliance","Unavailable","2","94%"]];
  return <div className="page-content split-page">
    <NextAvailablePanel />
    <Panel>
      <PanelHeader title="Staff availability" subtitle="Live workload and routing eligibility" action={<Button icon="plus">Add staff</Button>} />
      <div className="staff-table"><div className="staff-row head"><span>Staff member</span><span>Team</span><span>Availability</span><span>Open</span><span>SLA met</span></div>{staff.map((s,i)=><div className="staff-row" key={s[0]}><span><i className="avatar-small">{s[0].split(" ").map(x=>x[0]).join("")}</i><strong>{s[0]}</strong></span><span>{s[1]}</span><span><Badge tone={i<2?"green":i===2?"amber":"slate"} dot>{s[2]}</Badge></span><strong>{s[3]}</strong><span className="success-text">{s[4]}</span></div>)}</div>
    </Panel>
    <Panel>
      <PanelHeader title="Routing rules" subtitle="Property + category determines assignment chain" action={<Button variant="primary" icon="plus">New rule</Button>} />
      <div className="rule-list">{[
        ["The Foundry","Heating","Dana Hughes","Marcus Lee","Ruth Allen"],
        ["Harbour Court","Access","Marcus Lee","Priya Shah","Ruth Allen"],
        ["All properties","Safeguarding","Priya Shah","Dana Hughes","James Cole"],
        ["Arcadia House","Plumbing","Dana Hughes","Marcus Lee","James Cole"],
      ].map((r,i)=><div className="rule" key={r[0]+r[1]}><div className="rule-number">{i+1}</div><div><small>PROPERTY</small><strong>{r[0]}</strong></div><Icon name="plus" /><div><small>CATEGORY</small><strong>{r[1]}</strong></div><Icon name="chevron" /><div><small>PRIMARY</small><strong>{r[2]}</strong></div><Icon name="chevron" /><div><small>BACKUP</small><strong>{r[3]}</strong></div><Icon name="chevron" /><div><small>MANAGER</small><strong>{r[4]}</strong></div><Icon name="more" /></div>)}</div>
    </Panel>
  </div>;
}

function SlaMonitor() {
  return <>
    <div className="state-grid">
      {[["Within SLA","177","87.6%","green","4h 18m avg. remaining"],["At Risk","18","8.9%","amber","Next breach in 18m"],["Breached","7","3.5%","red","Oldest breach 2h 14m"],["Escalated","11","5.4%","purple","3 awaiting manager"]].map(s=><Panel className={`state-card ${s[3]}`} key={s[0]}><Badge tone={s[3] as Tone} dot>{s[0]}</Badge><strong>{s[1]}</strong><span>{s[2]} of active tickets</span><small>{s[4]}</small></Panel>)}
    </div>
    <Panel>
      <PanelHeader title="SLA exception monitor" subtitle="Tickets requiring operational attention" action={<Button icon="download">Export</Button>} />
      <div className="exception-table">
        <div className="exception-row head"><span>Ticket</span><span>Issue</span><span>Property</span><span>Owner</span><span>Policy</span><span>State</span><span>Timer</span><span>Next action</span></div>
        {tickets.slice(0,5).map((t,i)=><div className="exception-row" key={t.id}><strong className="ticket-id">{t.id}</strong><span>{t.category}</span><span>{t.property}</span><span>{t.staff}</span><span>{i===0?"Emergency · 2h":"Standard · 8h"}</span><span><Badge tone={i===3?"red":i<2?"amber":"green"}>{i===3?"Breached":i<2?"At risk":"Within SLA"}</Badge></span><strong className={i===3?"danger-text":i<2?"warning-text":""}>{i===3?"+00:16":t.sla}</strong><span className="text-link">{i===3?"Manager review":"Contact assignee"}</span></div>)}
      </div>
    </Panel>
  </>;
}

function SlaPage() {
  const [tab, setTab] = useState("monitor");
  return <div className="page-content">
    <EntTabs value={tab} onChange={setTab} tabs={[["monitor", "Monitor"], ["policies", "SLA policies"], ["escalation", "Escalation chains"]]} />
    {tab === "monitor" && <SlaMonitor />}
    {tab === "policies" && <SlaPolicies />}
    {tab === "escalation" && <EscalationBuilder />}
  </div>;
}

function AiPage() {
  return <div className="page-content">
    <div className="ai-kpis"><MetricCard label="Tickets analysed" value="1,284" delta="98.7%" detail="successful pipeline" tone="purple" /><MetricCard label="Avg. confidence" value="92.4%" delta="+1.8%" detail="this month" tone="purple" /><MetricCard label="Negative sentiment" value="23%" delta="296" detail="tickets flagged" tone="red" /><MetricCard label="Auto-routed" value="89%" delta="1,143" detail="without intervention" tone="teal" /></div>
    <Panel className="pipeline-panel"><PanelHeader title="Automation pipeline" subtitle="From contact notes to operational action" action={<Badge tone="green" dot>All systems operational</Badge>} />
      <div className="pipeline"><div><span className="pipeline-icon"><Icon name="file" /></span><small>INPUT</small><strong>Contact notes</strong><em>CRM data</em></div><Icon name="chevron" /><div><span className="pipeline-icon purple"><Icon name="spark" /></span><small>AI CLASSIFICATION</small><strong>Category</strong><em>94.6% confidence</em></div><Icon name="chevron" /><div><span className="pipeline-icon purple"><Icon name="spark" /></span><small>AI ANALYSIS</small><strong>Sentiment + urgency</strong><em>92.4% confidence</em></div><Icon name="chevron" /><div><span className="pipeline-icon teal"><Icon name="route" /></span><small>SYSTEM ACTION</small><strong>Allocation</strong><em>Rules + availability</em></div><Icon name="chevron" /><div><span className="pipeline-icon red"><Icon name="clock" /></span><small>CONDITIONAL</small><strong>Escalation</strong><em>SLA + risk signals</em></div></div>
    </Panel>
    <div className="dashboard-main">
      <Panel><PanelHeader title="Sentiment by property" subtitle="Tenant contact analysis · Last 30 days" /><div className="property-sentiment">{["The Foundry","Harbour Court","Arcadia House","Quayside Place"].map((p,i)=><div key={p}><strong>{p}</strong><div className="stacked"><i style={{width:`${25+i*4}%`}} /><i style={{width:`${42-i*2}%`}} /><i style={{flex:1}} /></div><span className={i===0?"danger-text":""}>{31-i*5}% negative</span></div>)}</div></Panel>
      <Panel><PanelHeader title="Recent low-confidence results" subtitle="Requires human review" action={<Badge tone="amber">8 queued</Badge>} /><div className="review-list">{tickets.slice(0,4).map((t,i)=><div key={t.id}><span><strong>{t.id} · {t.category}</strong><small>{t.tenant} · {t.property}</small></span><Badge tone="purple">{71+i*3}% confidence</Badge><Button>Review</Button></div>)}</div></Panel>
    </div>
  </div>;
}

function Reports() {
  return <div className="page-content">
    <div className="reports-top"><Panel><PanelHeader title="Daily operations report" subtitle="Automatically generated every day at 07:00" action={<Badge tone="green" dot>Active</Badge>} /><div className="report-preview"><span className="report-icon"><Icon name="file" size={24}/></span><span><strong>Operations summary · 14 Jan 2025</strong><small>Generated today at 07:02 · 24 pages · 1.8 MB</small></span></div><div className="report-actions"><Button icon="download">PDF</Button><Button icon="download">Excel</Button><Button>Configure schedule</Button></div></Panel>
      <Panel><PanelHeader title="Monthly performance report" subtitle="Automatically generated on the 1st of each month" action={<Badge tone="green" dot>Active</Badge>} /><div className="report-preview"><span className="report-icon teal"><Icon name="chart" size={24}/></span><span><strong>Service performance · December 2024</strong><small>Generated 1 Jan 2025 · 48 pages · 3.2 MB</small></span></div><div className="report-actions"><Button icon="download">PDF</Button><Button icon="download">Excel</Button><Button>Configure schedule</Button></div></Panel></div>
    <Panel><PanelHeader title="Report library" subtitle="Generated reports and exports" action={<Button variant="primary" icon="plus">Create custom report</Button>} /><div className="report-table"><div className="report-row head"><span>Report</span><span>Type</span><span>Period</span><span>Generated</span><span>Owner</span><span>Formats</span><span /></div>{[["Operations summary","Daily","14 Jan 2025","Today, 07:02"],["Operations summary","Daily","13 Jan 2025","Yesterday, 07:01"],["Service performance","Monthly","December 2024","1 Jan, 07:04"],["SLA exception audit","Custom","Q4 2024","2 Jan, 14:32"]].map((r,i)=><div className="report-row" key={r[2]}><span><Icon name="file"/><strong>{r[0]}</strong></span><span><Badge tone={i===2?"teal":"slate"}>{r[1]}</Badge></span><span>{r[2]}</span><span>{r[3]}</span><span>{i===3?"Ruth Allen":"System"}</span><span><Badge tone="red">PDF</Badge> <Badge tone="green">XLSX</Badge></span><span><Icon name="more"/></span></div>)}</div></Panel>
  </div>;
}

function Migration() {
  return <div className="page-content">
    <div className="migration-steps"><span className="done"><i><Icon name="check"/></i>Select data</span><b /><span className="active"><i>2</i>Upload & validate</span><b /><span><i>3</i>Map fields</span><b /><span><i>4</i>Review</span><b /><span><i>5</i>Import</span></div>
    <div className="migration-grid"><Panel><PanelHeader title="Upload source file" subtitle="Import property, tenant, lease or historic ticket data" /><div className="upload-zone"><span className="upload-icon"><Icon name="upload" size={24}/></span><strong>Drop an Excel file here</strong><span>or select a file from your computer</span><Button variant="primary">Select .xlsx file</Button><small>Maximum file size 50 MB · Template available</small></div></Panel>
      <Panel><PanelHeader title="Latest migration" subtitle="tenants_jan_2025.xlsx" action={<Badge tone="amber">Validation issues</Badge>} /><div className="migration-progress"><span><strong>8,420</strong><small>Rows scanned</small></span><span><strong className="success-text">8,371</strong><small>Valid</small></span><span><strong className="warning-text">37</strong><small>Warnings</small></span><span><strong className="danger-text">12</strong><small>Errors</small></span></div><div className="progress migration-bar"><i /></div><div className="file-meta"><span>Validation complete</span><strong>99.4% ready</strong></div></Panel></div>
    <Panel><PanelHeader title="Validation results" subtitle="49 rows require review before migration can start" action={<div className="report-actions"><Button>Download error file</Button><Button variant="primary">Review field mapping</Button></div>} /><div className="validation-list">{[
      ["Error","12","Missing required lease_start_date","Rows 118, 342, 891 + 9 more","red"],
      ["Warning","21","Property reference not found; new property will be created","Rows 74, 603, 1104 + 18 more","amber"],
      ["Warning","16","Duplicate tenant email detected","Rows 39, 482, 1120 + 13 more","amber"],
      ["Passed","8,371","All required fields valid","Ready for field mapping","green"]
    ].map(v=><div key={v[2]}><Badge tone={v[4] as Tone}>{v[0]} · {v[1]}</Badge><span><strong>{v[2]}</strong><small>{v[3]}</small></span><span className="text-link">{v[0]==="Passed"?"View sample":"Review rows"}</span></div>)}</div></Panel>
  </div>;
}

function GenericPage({ title }: { title: string }) {
  return <div className="page-content"><Panel><PanelHeader title={`${title} overview`} subtitle="CRM records and operational data" action={<Button variant="primary" icon="plus">Add new</Button>} /><div className="empty-dashboard"><span className="empty-icon"><Icon name={title === "Properties" ? "building" : title === "Tenants" ? "person" : "settings"} size={28}/></span><strong>{title} workspace</strong><span>Search, filter and manage all {title.toLowerCase()} records from this operational workspace.</span><Button>Browse records</Button></div></Panel></div>;
}

function AppShell() {
  const [page, setPage] = useState("dashboard");
  const [subPage, setSubPage] = useState<"none" | "create" | "detail">("none");
  const current = navItems.find(n => n[0] === page);
  const titles: Record<string, [string, string]> = {
    dashboard: ["Operations Dashboard", "Real-time helpdesk performance across all properties"],
    tickets: ["Ticket Queue", "Triage, assign and manage resident issues"],
    "my-queue": ["My Queue", "Tickets currently assigned to you"],
    "team-queue": ["Team Queue", "Live workload across the operations team"],
    properties: ["Properties", "Property records, units and service performance"],
    tenants: ["Tenants", "Tenant, contact and tenancy records"],
    routing: ["Allocation & Routing", "Manage staff availability and automated assignment rules"],
    sla: ["SLA & Escalations", "Monitor commitments, set SLA policies and build escalation chains"],
    ai: ["AI & Sentiment", "Model performance, sentiment signals and automation pipeline"],
    reports: ["Reports", "Scheduled operational reporting and custom exports"],
    migration: ["Data Migration", "Validate and import CRM records from Excel"],
    admin: ["Administration", "Roles, permissions, users, skills, categories and licensing"],
  };
  const [title, subtitle] = subPage === "create" ? ["Create Ticket", "Log, enrich and route a new tenant issue"] : subPage === "detail" ? ["Ticket Detail", "Ticket HD-24891"] : titles[page];
  const goPage = (id: string) => { setPage(id); setSubPage("none"); };
  let content: ReactNode;
  if (subPage === "create") content = <CreateTicket onCancel={() => setSubPage("none")} />;
  else if (subPage === "detail") content = <TicketDetail onBack={() => setSubPage("none")} />;
  else if (page === "dashboard") content = <Dashboard />;
  else if (["tickets","my-queue","team-queue"].includes(page)) content = <Queue onTicket={() => setSubPage("detail")} />;
  else if (page === "routing") content = <Routing />;
  else if (page === "sla") content = <SlaPage />;
  else if (page === "ai") content = <AiPage />;
  else if (page === "reports") content = <Reports />;
  else if (page === "migration") content = <Migration />;
  else if (page === "admin") content = <AdminPage />;
  else content = <GenericPage title={current?.[1] || "Administration"} />;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><span /></span><div><strong>PropDesk</strong><small>OPERATIONS CRM</small></div></div>
      <nav>{navItems.map((item, i) => <div key={item[0]} className={`${page === item[0] && subPage === "none" ? "active" : ""} ${i === 4 || i === 6 || i === 9 ? "nav-separator" : ""}`} role="button" onClick={() => goPage(item[0])}><Icon name={item[2]} /><span>{item[1]}</span>{item[0] === "tickets" && <b>128</b>}{item[0] === "sla" && <b className="alert-count">7</b>}</div>)}</nav>
      <div className="sidebar-footer"><div className="system-status"><i /><span><strong>All systems operational</strong><small>Last checked 1m ago</small></span></div><div className="user-card"><span className="user-avatar">OP</span><span><strong>Olivia Price</strong><small>Super Admin</small></span><Icon name="more" /></div></div>
    </aside>
    <main className="main">
      <Header title={title} subtitle={subtitle} onCreate={() => setSubPage("create")} />
      {content}
      <footer><SourceKey /><span>Data refreshed 14 Jan 2025, 11:24:18 · Internal use only</span></footer>
    </main>
  </div>;
}

export default function App() {
  return <EnterpriseProvider><AppShell /></EnterpriseProvider>;
}
