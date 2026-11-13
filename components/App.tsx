"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Tone } from "@/lib/model";
import { PERSONAS } from "@/lib/seed";
import { categoryOf, fmtMins, hasModule, initials, isActive, isStaffRole, locationName, markRead, notificationsFor, pendingDecline, roleOf, slaInfo, userName, visibleTickets } from "@/lib/workflows";
import { EnterpriseProvider, AdminPage, SlaPolicies, EscalationBuilder, NextAvailablePanel, EntTabs } from "./Enterprise";
import { WorkspaceProvider, useWorkspace } from "./Workspace";
import { CreateTicket, TicketDetail, TicketQueue, type QueueTab } from "./Tickets";
import { LocationsPage } from "./Locations";
import { availTone, Badge, Button, ConfirmDialog, EmptyState, Icon, Panel, PanelHeader, clock, when } from "./ui";
import TicketRep from "./TicketRep";
import Walkthrough from "./Walkthrough";

/** [id, label, icon, nav group] */
const navItems: [string, string, string, number][] = [
  ["dashboard", "Dashboard", "grid", 0],
  ["tickets", "Tickets", "ticket", 0],
  ["ticket-rep", "Ticket Rep", "file", 0],
  ["walkthrough", "Walkthrough", "spark", 0],
  ["my-queue", "My Queue", "inbox", 0],
  ["team-queue", "Team Queue", "users", 0],
  ["properties", "Properties", "building", 1],
  ["tenants", "Tenants", "person", 1],
  ["routing", "Staff & Routing", "route", 2],
  ["sla", "SLA & Escalations", "clock", 2],
  ["ai", "AI & Sentiment", "spark", 2],
  ["reports", "Reports", "chart", 3],
  ["migration", "Data Migration", "upload", 3],
  ["admin", "Administration", "settings", 3],
];

function SourceKey() {
  return <div className="source-key">
    <span><i className="key-dot crm" />CRM Data</span><span><i className="key-dot ai" />AI Generated</span><span><i className="key-dot system" />System Generated</span><span><i className="key-dot staff" />Staff Action</span><span><i className="key-dot manager" />Manager Action</span>
  </div>;
}

/* ------------------------------------------------------------------ */
/* Header: location selector + notifications                           */
/* ------------------------------------------------------------------ */
function LocationSelect() {
  const { ws, myLocationIds, locationId, setLocationId } = useWorkspace();
  const locs = ws.locations.filter((l) => myLocationIds.includes(l.id));
  return <label className="location-select" title="Filter the workspace by apartment location">
    <Icon name="pin" size={14} />
    <select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Location" disabled={locs.length <= 1}>
      {locs.length === 0 && <option value="all">No locations assigned</option>}
      {locs.length > 1 && <option value="all">All my locations ({locs.length})</option>}
      {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  </label>;
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open, close]);
  return ref;
}

function NotificationsBell({ onTicket }: { onTicket: (id: string) => void }) {
  const { ws, me, now, updateWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const list = notificationsFor(ws, me);
  const unread = list.filter((n) => me && !n.readBy.includes(me.id));
  const read = (ids: string[]) => me && updateWorkspace((w) => markRead(w, me, ids));
  return <div className="menu-anchor" ref={ref}>
    <div className="icon-button" role="button" tabIndex={0} aria-label={`Notifications, ${unread.length} unread`} onClick={() => setOpen((v) => !v)}><Icon name="bell" />{unread.length > 0 && <span className="notification-dot" />}</div>
    {open && <div className="pop-menu notif-menu">
      <div className="pop-head"><span><strong>Notifications</strong><small>{ws.customer.name} · in-app (simulated)</small></span>{unread.length > 0 && <span className="text-link" role="button" onClick={() => read(unread.map((n) => n.id))}>Mark all read</span>}</div>
      {list.length === 0 && <div className="pop-empty">You&apos;re all caught up.</div>}
      {list.slice(0, 12).map((n) => <div key={n.id} className={`notif-item ${me && !n.readBy.includes(me.id) ? "unread" : ""}`} role="button" onClick={() => { read([n.id]); setOpen(false); onTicket(n.ticketId); }}>
        <i className={`notif-dot ${n.title.startsWith("Decline rejected") ? "red" : n.title.startsWith("Decline approved") ? "green" : n.title.startsWith("Decline") ? "purple" : "blue"}`} />
        <span><strong>{n.title}</strong><small>{n.body}</small><em>{when(n.at, now)} · {locationName(ws, n.locationId)}</em></span>
      </div>)}
    </div>}
  </div>;
}

function Header({ title, subtitle, onCreate, onTicket, onMenu }: { title: string; subtitle: string; onCreate: () => void; onTicket: (id: string) => void; onMenu: () => void }) {
  const { ws, can } = useWorkspace();
  return <header className="topbar">
    <div className="topbar-title"><span className="icon-button menu-button" role="button" aria-label="Open navigation" onClick={onMenu}><Icon name="menu" /></span><div><div className="eyebrow">{ws.customer.name.toUpperCase()} / {title.toUpperCase()}</div><div className="page-title">{title}</div><div className="page-subtitle">{subtitle}</div></div></div>
    <div className="header-actions">
      <LocationSelect />
      <div className="global-search"><Icon name="search" /><span>Search tickets, tenants, properties</span><kbd>⌘ K</kbd></div>
      <NotificationsBell onTicket={onTicket} />
      {can("create") && <Button variant="primary" icon="plus" onClick={onCreate}>Create ticket</Button>}
    </div>
  </header>;
}

/* ------------------------------------------------------------------ */
/* Sidebar: customer workspace switcher + simulated sign-in            */
/* ------------------------------------------------------------------ */
function WorkspaceSwitcher({ onSwitched }: { onSwitched: () => void }) {
  const { ws, licence, memberships, switchCustomer } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const multi = memberships.length > 1;
  return <div className="ws-switcher menu-anchor" ref={ref}>
    <div className={`ws-current ${multi ? "multi" : ""}`} role={multi ? "button" : undefined} tabIndex={multi ? 0 : undefined} aria-haspopup={multi || undefined} onClick={multi ? () => setOpen((v) => !v) : undefined} title={multi ? "Switch customer workspace" : undefined}>
      <span className="ws-avatar">{ws.customer.short}</span>
      <span className="ws-text"><small>ZONGOVITA · CUSTOMER</small><strong>{ws.customer.name}</strong><em>{ws.locations.length} locations · {ws.customer.region}</em>{licence.ok ? (licence.daysLeft <= 30 && <em className="ws-warn">Licence ends in {licence.daysLeft} days</em>) : <em className="ws-expired">Licence expired</em>}</span>
      {multi && <Icon name="swap" size={14} />}
    </div>
    {open && <div className="pop-menu ws-menu">
      <div className="pop-head"><span><strong>Switch workspace</strong><small>Each customer&apos;s data and settings are separate</small></span></div>
      {memberships.map((m) => <div key={m.customerId} role="button" className={`ws-option ${m.customerId === ws.customer.id ? "active" : ""}`} onClick={() => { switchCustomer(m.customerId); setOpen(false); onSwitched(); }}>
        <span className="ws-avatar small">{initials(m.customerName)}</span><span><strong>{m.customerName}</strong><small>{m.roleName}</small></span><LicenceTag customerId={m.customerId} />{m.customerId === ws.customer.id && <Icon name="check" size={13} />}
      </div>)}
    </div>}
  </div>;
}

/** Licence state per customer, read from the Licence Registry (no customer business data). */
function LicenceTag({ customerId }: { customerId: string }) {
  const { licenceFor } = useWorkspace();
  return licenceFor(customerId).ok ? null : <Badge tone="red">Expired</Badge>;
}

function PersonaMenu({ onSwitched }: { onSwitched: () => void }) {
  const { persona, me, ws, switchPersona, resetDemo } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return <div className="menu-anchor" ref={ref}>
    <div className="user-card" role="button" tabIndex={0} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
      <span className="user-avatar">{initials(persona.name)}</span><span><strong>{persona.name}</strong><small>{me ? roleOf(ws, me)?.name : "No access"}</small></span><Icon name="more" />
    </div>
    {open && <div className="pop-menu persona-menu">
      <div className="pop-head"><span><strong>Simulated sign-in</strong><small>Prototype only. Switch persona to test roles and locations. This is not real authentication.</small></span></div>
      {PERSONAS.map((p) => <div key={p.id} role="button" className={`ws-option ${p.id === persona.id ? "active" : ""}`} onClick={() => { switchPersona(p.id); setOpen(false); onSwitched(); }}>
        <span className="user-avatar">{initials(p.name)}</span><span><strong>{p.name}</strong><small>{p.title}</small></span>{p.id === persona.id && <Icon name="check" size={13} />}
      </div>)}
      <div className="pop-foot" role="button" onClick={() => { setOpen(false); setConfirm(true); }}><Icon name="refresh" size={13} />Reset demo data…</div>
    </div>}
    {confirm && <ConfirmDialog title="Reset demo data?" tone="danger" confirm="Reset all workspaces" onConfirm={() => { resetDemo(); onSwitched(); }} onClose={() => setConfirm(false)}
      body={<>All tickets, decline requests, locations and configuration changes in <b>every</b> customer workspace go back to the original sample data. This only affects this browser.</>} />}
  </div>;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */
function MetricCard({ label, value, delta, tone, detail, onClick }: { label: string; value: string; delta: string; tone: Tone; detail: string; onClick?: () => void }) {
  return <section className={`panel metric metric-${tone} ${onClick ? "metric-click" : ""}`} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}>
    <div className="metric-top"><span>{label}</span><span className={`metric-mark ${tone}`} /></div>
    <div className="metric-value">{value}</div>
    <div className="metric-meta"><strong>{delta}</strong><span>{detail}</span></div>
  </section>;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function Dashboard({ onNav, onTicket }: { onNav: (page: string, tab?: QueueTab) => void; onTicket: (id: string) => void }) {
  const { ws, me, locationId, myLocationIds, now, can } = useWorkspace();
  const ts = visibleTickets(ws, me, locationId);
  const act = ts.filter(isActive);
  const sla = act.map((t) => ({ t, s: slaInfo(ws, t, now) }));
  const atRisk = sla.filter((x) => x.s.state === "At risk");
  const breached = sla.filter((x) => x.s.state === "Breached");
  const within = act.length - atRisk.length - breached.length;
  const pending = act.filter((t) => pendingDecline(t));
  const neg = ts.filter((t) => t.sentiment === "Negative").length, pos = ts.filter((t) => t.sentiment === "Positive").length;
  const next = atRisk.sort((a, b) => a.s.remainingMins - b.s.remainingMins)[0];

  // Trend is sample data per customer, scaled to the selected location's share of tickets.
  const share = locationId === "all" ? 1 : ts.length / Math.max(1, ws.tickets.length);
  const created = ws.trend.created.map((v) => Math.round(v * share)), resolved = ws.trend.resolved.map((v) => Math.round(v * share));
  const max = Math.max(20, Math.ceil(Math.max(...created, ...resolved) / 20) * 20);
  const pts = (vs: number[]) => vs.map((v, i) => `${Math.round((i * 680) / 6)} ${Math.round(170 - (v / max) * 150)}`);
  const line = (vs: number[]) => `M${pts(vs).join(" L")}`;
  const days = Array.from({ length: 7 }, (_, i) => new Date(now - (6 - i) * 86400000).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit" }));

  const locs = ws.locations.filter((l) => myLocationIds.includes(l.id) && (locationId === "all" || l.id === locationId));
  const negByKey = new Map<string, number>();
  act.filter((t) => t.sentiment === "Negative").forEach((t) => { const k = `${categoryOf(ws, t)?.name}|${locationName(ws, t.locationId)}`; negByKey.set(k, (negByKey.get(k) ?? 0) + 1); });
  const hot = [...negByKey.entries()].sort((a, b) => b[1] - a[1])[0];
  const wPct = pct(within, act.length), rPct = pct(atRisk.length, act.length);

  return <div className="page-content">
    <div className="metrics-grid">
      <MetricCard label="Open tickets" value={String(act.length)} delta={String(act.filter((t) => t.assigneeId === null).length)} detail="in team queue" tone="blue" onClick={() => onNav("tickets")} />
      <MetricCard label="In progress" value={String(act.filter((t) => t.status === "In Progress").length)} delta={`${Math.round(pct(act.filter((t) => t.status === "In Progress").length, act.length))}%`} detail="of open workload" tone="teal" />
      <MetricCard label="SLA at risk" value={String(atRisk.length)} delta={next ? fmtMins(next.s.remainingMins) : "—"} detail="to next breach" tone="amber" onClick={() => onNav("sla")} />
      <MetricCard label="SLA breached" value={String(breached.length)} delta={`${pct(breached.length, act.length)}%`} detail="of active tickets" tone="red" onClick={() => onNav("sla")} />
      <MetricCard label="Escalated" value={String(act.filter((t) => t.status === "Escalated").length)} delta="Level 1+" detail="escalation chain" tone="purple" onClick={() => onNav("tickets", "escalated")} />
      <MetricCard label="Pending review" value={String(pending.length)} delta={can("review") ? "Needs you" : "Awaiting"} detail="decline requests" tone="purple" onClick={() => onNav("tickets", "review")} />
      <MetricCard label="Negative sentiment" value={`${Math.round(pct(neg, ts.length))}%`} delta={String(neg)} detail="tickets flagged" tone="red" />
    </div>
    <div className="dashboard-main">
      <Panel className="trend-panel">
        <PanelHeader title="Ticket volume" subtitle="Created vs resolved · Last 7 days" action={<div className="segmented"><span className="active">7D</span><span>30D</span><span>90D</span></div>} />
        <div className="chart-legend"><span><i className="line-key blue" />Created</span><span><i className="line-key teal" />Resolved</span><strong>{created.reduce((a, b) => a + b, 0)} total</strong></div>
        <div className="line-chart">
          <div className="y-labels"><span>{max}</span><span>{Math.round((max * 2) / 3)}</span><span>{Math.round(max / 3)}</span><span>0</span></div>
          <svg viewBox="0 0 680 180" preserveAspectRatio="none">
            <g className="grid-lines"><path d="M0 20H680M0 70H680M0 120H680M0 170H680" /></g>
            <path className="area created-area" d={`${line(created)} L680 170 L0 170Z`} />
            <path className="chart-line created" d={line(created)} />
            <path className="chart-line resolved" d={line(resolved)} />
            <g className="points">{pts(created).slice(-2).map((p) => { const [x, y] = p.split(" "); return <circle key={p} cx={x} cy={y} r="4" />; })}</g>
          </svg>
          <div className="x-labels">{days.map((d) => <span key={d}>{d}</span>)}</div>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="SLA health" subtitle={locationId === "all" ? "All active tickets in your locations" : `Active tickets · ${locationName(ws, locationId)}`} action={<span className="text-link" role="button" onClick={() => onNav("sla")}>View details</span>} />
        <div className="donut-row">
          <div className="donut" style={{ background: act.length ? `conic-gradient(var(--green) 0 ${wPct}%,#d29b30 ${wPct}% ${wPct + rPct}%,var(--red) ${wPct + rPct}%)` : "#edf0f3" }}><div><strong>{act.length}</strong><span>Active</span></div></div>
          <div className="donut-legend">
            <div><span><i className="key-dot success" />Within SLA</span><strong>{within} <small>{wPct}%</small></strong></div>
            <div><span><i className="key-dot warning" />At risk</span><strong>{atRisk.length} <small>{rPct}%</small></strong></div>
            <div><span><i className="key-dot danger" />Breached</span><strong>{breached.length} <small>{pct(breached.length, act.length)}%</small></strong></div>
          </div>
        </div>
        <div className="sla-note"><Icon name="clock" /><span><strong>{atRisk.length + breached.length} ticket{atRisk.length + breached.length === 1 ? "" : "s"} require action</strong><br />{next ? <>Next breach in {fmtMins(next.s.remainingMins)} · <span className="text-link" role="button" onClick={() => onTicket(next.t.id)}>{next.t.id}</span></> : "No tickets close to breach"}</span></div>
      </Panel>
    </div>
    <div className="dashboard-lower">
      <Panel>
        <PanelHeader title="Sentiment breakdown" subtitle="AI analysis · tickets in scope" action={<Badge tone="purple">AI generated</Badge>} />
        <div className="sentiment-bars">
          {([["Positive", pos, "positive"], ["Neutral", ts.length - pos - neg, "neutral"], ["Negative", neg, "negative"]] as const).map(([l, n, c]) => <div key={l}><span>{l}</span><div><i className={c} style={{ width: `${pct(n, ts.length)}%` }} /></div><strong>{Math.round(pct(n, ts.length))}%</strong></div>)}
        </div>
        <div className="insight"><span className="ai-icon"><Icon name="spark" /></span><span><strong>AI insight</strong>{hot ? `Negative sentiment is concentrated in ${hot[0].split("|")[0].toLowerCase()} tickets at ${hot[0].split("|")[1]} (${hot[1]} open).` : "No open tickets with negative sentiment."}</span></div>
      </Panel>
      <Panel className="property-panel">
        <PanelHeader title="Property comparison" subtitle={`Operational performance · ${ws.customer.name}`} action={<span className="text-link" role="button" onClick={() => onNav("properties")}>View all properties</span>} />
        <div className="data-table compact">
          <div className="table-row table-head"><span>Property</span><span>Open</span><span>SLA</span><span>Sentiment</span><span>Avg. resolve</span></div>
          {locs.length === 0 && <div className="table-row"><span className="ent-muted">No locations in scope</span></div>}
          {locs.map((l) => {
            const lt = ws.tickets.filter((t) => t.locationId === l.id), la = lt.filter(isActive);
            const ok = la.filter((t) => slaInfo(ws, t, now).state !== "Breached").length;
            const s = pct(ok, la.length) || (la.length ? 0 : 100);
            const net = lt.filter((t) => t.sentiment === "Positive").length - lt.filter((t) => t.sentiment === "Negative").length;
            return <div className="table-row" key={l.id}><span><span className="property-avatar">{l.name.charAt(0)}</span>{l.name}</span><strong>{la.length}</strong><span className={s < 90 ? "danger-text" : "success-text"}>{s}%</span><Badge tone={net < 0 ? "red" : net === 0 ? "slate" : "green"}>{net > 0 ? `+${net}` : net === 0 ? "0" : `−${-net}`}</Badge><span>{l.avgResolveHrs}h</span></div>;
          })}
        </div>
      </Panel>
    </div>
  </div>;
}

/* ------------------------------------------------------------------ */
/* Staff & routing, SLA, AI, reports, migration                        */
/* ------------------------------------------------------------------ */
function Routing() {
  const { ws, me, myLocationIds, locationId, now } = useWorkspace();
  const scope = locationId === "all" ? myLocationIds : [locationId];
  const staff = ws.users.filter((u) => isStaffRole(ws, u) && u.locationIds.some((l) => scope.includes(l)));
  const slaMet = (id: string) => { const ts = ws.tickets.filter((t) => t.assigneeId === id); return ts.length ? `${Math.round((ts.filter((t) => slaInfo(ws, t, now).state !== "Breached").length / ts.length) * 100)}%` : "—"; };
  const rules = ws.routingRules.filter((r) => r.locationId === "all" || scope.includes(r.locationId));
  return <div className="page-content split-page">
    <NextAvailablePanel locationIds={scope} />
    <Panel>
      <PanelHeader title="Staff availability" subtitle={`Live workload at ${locationId === "all" ? "your locations" : locationName(ws, locationId)}`} action={<Button icon="plus">Add staff</Button>} />
      <div className="staff-table"><div className="staff-row head"><span>Staff member</span><span>Team</span><span>Availability</span><span>Open</span><span>SLA met</span></div>
        {staff.length === 0 && <div className="staff-row"><span className="ent-muted">No staff assigned to these locations.</span></div>}
        {staff.map((s) => <div className="staff-row" key={s.id}><span><i className="avatar-small">{initials(s.name)}</i><strong>{s.name}</strong></span><span>{s.team ?? "—"}</span><span><Badge tone={availTone(s.availability)} dot>{s.availability}</Badge></span><strong>{ws.tickets.filter((t) => t.assigneeId === s.id && isActive(t)).length}</strong><span className="success-text">{slaMet(s.id)}</span></div>)}
      </div>
    </Panel>
    <Panel>
      <PanelHeader title="Routing rules" subtitle="Location + category determines assignment chain" action={<Button variant="primary" icon="plus">New rule</Button>} />
      <div className="rule-list">
        {rules.length === 0 && <div className="ent-pad ent-muted">No routing rules for these locations.</div>}
        {rules.map((r, i) => <div className="rule" key={r.id}><div className="rule-number">{i + 1}</div><div><small>PROPERTY</small><strong>{r.locationId === "all" ? "All properties" : locationName(ws, r.locationId)}</strong></div><Icon name="plus" /><div><small>CATEGORY</small><strong>{ws.categories.find((c) => c.id === r.categoryId)?.name ?? r.categoryId}</strong></div><Icon name="chevron" /><div><small>PRIMARY</small><strong>{userName(ws, r.primaryId)}</strong></div><Icon name="chevron" /><div><small>BACKUP</small><strong>{userName(ws, r.backupId)}</strong></div><Icon name="chevron" /><div><small>MANAGER</small><strong>{userName(ws, r.managerId)}</strong></div><Icon name="more" /></div>)}
      </div>
    </Panel>
    {me && <span className="ent-hint">Showing staff for {scope.length} location{scope.length === 1 ? "" : "s"} you can access in {ws.customer.name}.</span>}
  </div>;
}

function SlaMonitor({ onTicket }: { onTicket: (id: string) => void }) {
  const { ws, me, locationId, now } = useWorkspace();
  const act = visibleTickets(ws, me, locationId).filter(isActive).map((t) => ({ t, s: slaInfo(ws, t, now) }));
  const n = (st: string) => act.filter((x) => x.s.state === st);
  const esc = act.filter((x) => x.t.status === "Escalated");
  const rows = [...act].sort((a, b) => a.s.remainingMins - b.s.remainingMins).slice(0, 8);
  const soonest = n("At risk").sort((a, b) => a.s.remainingMins - b.s.remainingMins)[0];
  const oldest = n("Breached").sort((a, b) => a.s.remainingMins - b.s.remainingMins)[0];
  const cards: [string, number, string, Tone, string][] = [
    ["Within SLA", n("Within SLA").length, "green", "green", `${act.length} active tickets`],
    ["At Risk", n("At risk").length, "amber", "amber", soonest ? `Next breach in ${fmtMins(soonest.s.remainingMins)}` : "Nothing close to breach"],
    ["Breached", n("Breached").length, "red", "red", oldest ? `Oldest breach ${fmtMins(oldest.s.remainingMins)}` : "No breaches"],
    ["Escalated", esc.length, "purple", "purple", `${act.filter((x) => pendingDecline(x.t)).length} pending decline review`],
  ];
  return <>
    <div className="state-grid">
      {cards.map(([label, v, cls, tone, sub]) => <Panel className={`state-card ${cls}`} key={label}><Badge tone={tone} dot>{label}</Badge><strong>{v}</strong><span>{pct(v, act.length)}% of active tickets</span><small>{sub}</small></Panel>)}
    </div>
    <Panel>
      <PanelHeader title="SLA exception monitor" subtitle="Active tickets with the least time remaining" action={<Button icon="download">Export</Button>} />
      <div className="table-scroll"><div className="exception-table">
        <div className="exception-row head"><span>Ticket</span><span>Issue</span><span>Property</span><span>Owner</span><span>Policy</span><span>State</span><span>Timer</span><span>Next action</span></div>
        {rows.length === 0 && <EmptyState icon="check" title="No active tickets">Nothing to monitor at this location.</EmptyState>}
        {rows.map(({ t, s }) => <div className="exception-row" key={t.id}><strong className="ticket-id">{t.id}</strong><span>{categoryOf(ws, t)?.name}</span><span>{locationName(ws, t.locationId)}</span><span>{userName(ws, t.assigneeId)}</span><span>{s.policy.split(" · ").slice(1).join(" · ")}</span><span><Badge tone={s.state === "Breached" ? "red" : s.state === "At risk" ? "amber" : "green"}>{s.state}</Badge></span><strong className={s.state === "Breached" ? "danger-text" : s.state === "At risk" ? "warning-text" : ""}>{s.state === "Breached" ? `+${fmtMins(s.remainingMins)}` : fmtMins(s.remainingMins)}</strong><span className="text-link" role="button" onClick={() => onTicket(t.id)}>{pendingDecline(t) ? "Review decline" : s.state === "Breached" ? "Manager review" : t.assigneeId ? "Contact assignee" : "Assign owner"}</span></div>)}
      </div></div>
    </Panel>
  </>;
}

function SlaPage({ onTicket }: { onTicket: (id: string) => void }) {
  const { can } = useWorkspace();
  const [tab, setTab] = useState("monitor");
  const tabs: [string, string][] = can("config") ? [["monitor", "Monitor"], ["policies", "SLA policies"], ["escalation", "Escalation chains"]] : [["monitor", "Monitor"]];
  return <div className="page-content">
    <EntTabs value={tab} onChange={setTab} tabs={tabs} />
    {tab === "monitor" && <SlaMonitor onTicket={onTicket} />}
    {tab === "policies" && can("config") && <SlaPolicies />}
    {tab === "escalation" && can("config") && <EscalationBuilder />}
  </div>;
}

function AiPage({ onTicket }: { onTicket: (id: string) => void }) {
  const { ws, me, locationId, myLocationIds } = useWorkspace();
  const ts = visibleTickets(ws, me, locationId);
  const neg = ts.filter((t) => t.sentiment === "Negative").length;
  const locs = ws.locations.filter((l) => myLocationIds.includes(l.id) && (locationId === "all" || l.id === locationId));
  return <div className="page-content">
    <div className="ai-kpis"><MetricCard label="Tickets analysed" value={String(ts.length)} delta="100%" detail="successful pipeline" tone="purple" /><MetricCard label="Avg. confidence" value="92.4%" delta="sample" detail="model metric" tone="purple" /><MetricCard label="Negative sentiment" value={`${Math.round(pct(neg, ts.length))}%`} delta={String(neg)} detail="tickets flagged" tone="red" /><MetricCard label="Auto-routed" value={`${Math.round(pct(ts.filter((t) => t.history.some((e) => e.type === "assigned" && e.source === "system")).length, ts.length))}%`} delta={String(ts.filter((t) => t.history.some((e) => e.type === "assigned" && e.source === "system")).length)} detail="without intervention" tone="teal" /></div>
    <Panel className="pipeline-panel"><PanelHeader title="Automation pipeline" subtitle="From contact notes to operational action" action={<Badge tone="green" dot>All systems operational</Badge>} />
      <div className="pipeline"><div><span className="pipeline-icon"><Icon name="file" /></span><small>INPUT</small><strong>Contact notes</strong><em>CRM data</em></div><Icon name="chevron" /><div><span className="pipeline-icon purple"><Icon name="spark" /></span><small>AI CLASSIFICATION</small><strong>Category</strong><em>94.6% confidence</em></div><Icon name="chevron" /><div><span className="pipeline-icon purple"><Icon name="spark" /></span><small>AI ANALYSIS</small><strong>Sentiment + urgency</strong><em>92.4% confidence</em></div><Icon name="chevron" /><div><span className="pipeline-icon teal"><Icon name="route" /></span><small>SYSTEM ACTION</small><strong>Allocation</strong><em>Rules + availability</em></div><Icon name="chevron" /><div><span className="pipeline-icon red"><Icon name="clock" /></span><small>CONDITIONAL</small><strong>Escalation</strong><em>SLA + risk signals</em></div></div>
    </Panel>
    <div className="dashboard-main">
      <Panel><PanelHeader title="Sentiment by property" subtitle={`Tenant contact analysis · ${ws.customer.name}`} /><div className="property-sentiment">{locs.map((l) => {
        const lt = ws.tickets.filter((t) => t.locationId === l.id); const n = lt.length || 1;
        const p = lt.filter((t) => t.sentiment === "Positive").length, ng = lt.filter((t) => t.sentiment === "Negative").length;
        return <div key={l.id}><strong>{l.name}</strong><div className="stacked"><i style={{ width: `${(p / n) * 100}%` }} /><i style={{ width: `${((n - p - ng) / n) * 100}%` }} /><i style={{ flex: 1 }} /></div><span className={ng / n > 0.4 ? "danger-text" : ""}>{Math.round((ng / n) * 100)}% negative</span></div>;
      })}</div></Panel>
      <Panel><PanelHeader title="Recent low-confidence results" subtitle="Requires human review" action={<Badge tone="amber">{Math.min(4, ts.length)} queued</Badge>} /><div className="review-list">{ts.slice(0, 4).map((t, i) => <div key={t.id}><span><strong>{t.id} · {categoryOf(ws, t)?.name}</strong><small>{t.tenant} · {locationName(ws, t.locationId)}</small></span><Badge tone="purple">{71 + i * 3}% confidence</Badge><Button onClick={() => onTicket(t.id)}>Review</Button></div>)}</div></Panel>
    </div>
  </div>;
}

function Reports() {
  const { ws } = useWorkspace();
  const owner = ws.users.find((u) => u.roleId === "super")?.name ?? "Admin";
  return <div className="page-content">
    <div className="reports-top"><Panel><PanelHeader title="Daily operations report" subtitle="Automatically generated every day at 07:00" action={<Badge tone="green" dot>Active</Badge>} /><div className="report-preview"><span className="report-icon"><Icon name="file" size={24}/></span><span><strong>Operations summary · {ws.customer.name}</strong><small>Generated today at 07:02 · {ws.locations.length} locations · 1.8 MB</small></span></div><div className="report-actions"><Button icon="download">PDF</Button><Button icon="download">Excel</Button><Button>Configure schedule</Button></div></Panel>
      <Panel><PanelHeader title="Monthly performance report" subtitle="Automatically generated on the 1st of each month" action={<Badge tone="green" dot>Active</Badge>} /><div className="report-preview"><span className="report-icon teal"><Icon name="chart" size={24}/></span><span><strong>Service performance · last month</strong><small>Generated on the 1st · 48 pages · 3.2 MB</small></span></div><div className="report-actions"><Button icon="download">PDF</Button><Button icon="download">Excel</Button><Button>Configure schedule</Button></div></Panel></div>
    <Panel><PanelHeader title="Report library" subtitle="Generated reports and exports" action={<Button variant="primary" icon="plus">Create custom report</Button>} /><div className="table-scroll"><div className="report-table"><div className="report-row head"><span>Report</span><span>Type</span><span>Period</span><span>Generated</span><span>Owner</span><span>Formats</span><span /></div>{[["Operations summary","Daily","Today","Today, 07:02"],["Operations summary","Daily","Yesterday","Yesterday, 07:01"],["Service performance","Monthly","Last month","1st, 07:04"],["SLA exception audit","Custom","Last quarter","2nd, 14:32"]].map((r,i)=><div className="report-row" key={r[2]}><span><Icon name="file"/><strong>{r[0]}</strong></span><span><Badge tone={i===2?"teal":"slate"}>{r[1]}</Badge></span><span>{r[2]}</span><span>{r[3]}</span><span>{i===3?owner:"System"}</span><span><Badge tone="red">PDF</Badge> <Badge tone="green">XLSX</Badge></span><span><Icon name="more"/></span></div>)}</div></div></Panel>
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

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */
function AppShell() {
  const { ws, entry, licence, me, persona, can, myLocationIds, locationId, now } = useWorkspace();
  const [page, setPage] = useState("dashboard");
  const [queueTab, setQueueTab] = useState<QueueTab | null>(null);
  const [subPage, setSubPage] = useState<"none" | "create" | "detail">("none");
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // SIMULATED: navigation follows the persona's permissions in the active customer.
  // Licensed modules (from the Licence Registry) gate whole sections.
  const moduleFor: Record<string, Parameters<typeof hasModule>[1]> = { sla: "sla", ai: "ai", reports: "reports", migration: "migration" };
  const allowed = (id: string) => (!moduleFor[id] || hasModule(entry, moduleFor[id])) && (
    id === "routing" || id === "ai" || id === "reports" ? can("reassign") || can("config")
    : id === "migration" ? can("config")
    : id === "admin" ? can("users") || can("config") || can("billing")
    : can("view"));
  const visibleNav = navItems.filter((n) => allowed(n[0]));
  const effectivePage = allowed(page) ? page : "dashboard";

  const titles: Record<string, [string, string]> = {
    dashboard: ["Operations Dashboard", `Real-time helpdesk performance across ${locationId === "all" ? "your locations" : locationName(ws, locationId)}`],
    tickets: ["Ticket Queue", "Triage, assign and manage resident issues"],
    "ticket-rep": ["Ticket Rep", "How HD-24891 moves from the call to resolution"],
    walkthrough: ["Walkthrough", "Raise an issue and follow it through every role until close"],
    "my-queue": ["My Queue", "Tickets currently assigned to you"],
    "team-queue": ["Team Queue", "Unassigned tickets waiting for pickup"],
    properties: ["Properties & Locations", "Apartment locations, staff assignment and site operations"],
    tenants: ["Tenants", "Tenant, contact and tenancy records"],
    routing: ["Allocation & Routing", "Manage staff availability and automated assignment rules"],
    sla: ["SLA & Escalations", "Monitor commitments, set SLA policies and build escalation chains"],
    ai: ["AI & Sentiment", "Model performance, sentiment signals and automation pipeline"],
    reports: ["Reports", "Scheduled operational reporting and custom exports"],
    migration: ["Data Migration", "Validate and import CRM records from Excel"],
    admin: ["Administration", `Roles, permissions, users, skills, categories, decline reasons and licensing for ${ws.customer.name}`],
  };
  const [title, subtitle] = subPage === "create" ? ["Create Ticket", "Log, enrich and route a new tenant issue"] : subPage === "detail" ? ["Ticket Detail", `Ticket ${ticketId}`] : titles[effectivePage];
  const goPage = (id: string, tab?: QueueTab) => { setPage(id); setQueueTab(tab ?? null); setSubPage("none"); setNavOpen(false); };
  const openTicket = (id: string) => { setTicketId(id); setSubPage("detail"); };
  const reset = () => { setPage("dashboard"); setSubPage("none"); setTicketId(null); setQueueTab(null); };
  const visible = visibleTickets(ws, me, locationId);
  const activeCount = visible.filter(isActive).length;
  const breached = visible.filter((t) => isActive(t) && slaInfo(ws, t, now).state === "Breached").length;
  const pendingCount = visible.filter((t) => pendingDecline(t) && can("review")).length;

  let content: ReactNode;
  if (!licence.ok) content = <div className="page-content"><Panel><EmptyState icon="lock" title={`${ws.customer.name}: licence expired`} action={<span className="ent-hint">Data is kept. Switch workspace{persona.memberships.length > 1 ? " from the sidebar" : " or persona"} to continue.</span>}>{licence.reason} Contact ZongoVita to renew.</EmptyState></Panel></div>;
  else if (!me) content = <div className="page-content"><Panel><EmptyState icon="lock" title={`${persona.name} has no access to ${ws.customer.name}`}>The user record for this persona was removed from the workspace. Switch persona from the menu at the bottom of the sidebar, or reset the demo data.</EmptyState></Panel></div>;
  else if (subPage === "create") content = <CreateTicket onCancel={() => setSubPage("none")} onCreated={openTicket} />;
  else if (subPage === "detail" && ticketId) content = <TicketDetail ticketId={ticketId} onBack={() => setSubPage("none")} />;
  else if (effectivePage === "dashboard") content = <Dashboard onNav={goPage} onTicket={openTicket} />;
  else if (effectivePage === "ticket-rep") content = <TicketRep />;
  else if (effectivePage === "walkthrough") content = <Walkthrough />;
  else if (["tickets", "my-queue", "team-queue"].includes(effectivePage)) {
    const tab: QueueTab = queueTab ?? (effectivePage === "my-queue" ? "mine" : effectivePage === "team-queue" ? "unassigned" : "all");
    content = <TicketQueue key={`${effectivePage}-${tab}`} initialTab={tab} onTicket={openTicket} />;
  }
  else if (effectivePage === "properties") content = <LocationsPage onTicket={openTicket} />;
  else if (effectivePage === "routing") content = <Routing />;
  else if (effectivePage === "sla") content = <SlaPage onTicket={openTicket} />;
  else if (effectivePage === "ai") content = <AiPage onTicket={openTicket} />;
  else if (effectivePage === "reports") content = <Reports />;
  else if (effectivePage === "migration") content = <Migration />;
  else if (effectivePage === "admin") content = <AdminPage />;
  else content = <GenericPage title={navItems.find((n) => n[0] === effectivePage)?.[1] || "Administration"} />;

  return <div className="app-shell">
    {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
    <aside className={`sidebar ${navOpen ? "open" : ""}`}>
      <div className="brand"><span className="brand-mark"><span /></span><div><strong>PropDesk</strong><small>OPERATIONS CRM</small></div></div>
      <WorkspaceSwitcher onSwitched={reset} />
      <nav>{visibleNav.map((item, i) => <div key={item[0]} className={`${effectivePage === item[0] && subPage === "none" ? "active" : ""} ${i > 0 && visibleNav[i - 1][3] !== item[3] ? "nav-separator" : ""}`} role="button" tabIndex={0} onClick={() => goPage(item[0])} onKeyDown={(e) => e.key === "Enter" && goPage(item[0])}>
        <Icon name={item[2]} /><span>{item[1]}</span>
        {item[0] === "tickets" && pendingCount > 0 && <b className="review-count" role="button" title="Decline requests awaiting your review" onClick={(e) => { e.stopPropagation(); goPage("tickets", "review"); }}>{pendingCount} review</b>}
        {item[0] === "tickets" && <b>{activeCount}</b>}
        {item[0] === "sla" && breached > 0 && <b className="alert-count">{breached}</b>}
      </div>)}</nav>
      <div className="sidebar-footer"><div className="system-status"><i /><span><strong>Prototype · simulated data</strong><small>{myLocationIds.length} location{myLocationIds.length === 1 ? "" : "s"} in scope</small></span></div><PersonaMenu onSwitched={reset} /></div>
    </aside>
    <main className="main" key={ws.customer.id}>
      <Header title={title} subtitle={subtitle} onCreate={() => setSubPage("create")} onTicket={openTicket} onMenu={() => setNavOpen(true)} />
      {content}
      <footer><SourceKey /><span>{ws.customer.name} · Frontend prototype, data stored in this browser · Refreshed {clock(new Date(now).toISOString())}</span></footer>
    </main>
  </div>;
}

export default function App() {
  return <WorkspaceProvider><EnterpriseProvider><AppShell /></EnterpriseProvider></WorkspaceProvider>;
}
