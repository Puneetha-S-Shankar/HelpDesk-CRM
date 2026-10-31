"use client";

import { useMemo, useRef, useState } from "react";
import { PRIORITIES, type DeclineRequest, type EventSource, type Priority, type Sentiment, type Ticket, type TicketStatus } from "@/lib/model";
import {
  addNote, approveDecline, canDecline, canReview, canSeeTicket, categoryOf, createTicket, escalateTicket, fmtMins, initials, isActive, isStaffRole,
  lastDecline, locationName, pendingDecline, reassignTicket, recommendStaff, rejectDecline, requestDecline, resolveTicket, roleOf, slaInfo,
  startWork, takeFromQueue, topRecommendation, userById, userName, validateDecline, visibleTickets, type AssignTarget,
} from "@/lib/workflows";
import { useWorkspace } from "./Workspace";
import { availTone, Badge, Button, clock, ConfirmDialog, day, EmptyState, Icon, Modal, Note, Panel, PanelHeader, priorityTone, sentimentTone, slaTone, statusTone, when } from "./ui";

/* ------------------------------------------------------------------ */
/* Ticket queue                                                        */
/* ------------------------------------------------------------------ */
export type QueueTab = "all" | "unassigned" | "mine" | "escalated" | "review";
const STATUSES: TicketStatus[] = ["Open", "In Progress", "Escalated", "Pending Admin Review", "Resolved"];
const PAGE = 8;

export function TicketQueue({ initialTab, onTicket }: { initialTab: QueueTab; onTicket: (id: string) => void }) {
  const { ws, me, locationId, now } = useWorkspace();
  const [tab, setTab] = useState<QueueTab>(initialTab);
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [prio, setPrio] = useState<Priority | "">("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);

  const all = visibleTickets(ws, me, locationId);
  const inReview = (t: Ticket) => { const d = pendingDecline(t); return !!d && (canReview(ws, me, t) || d.requestedById === me?.id); };
  const byTab: Record<QueueTab, Ticket[]> = {
    all,
    unassigned: all.filter((t) => t.assigneeId === null && isActive(t)),
    mine: all.filter((t) => t.assigneeId === me?.id && isActive(t)),
    escalated: all.filter((t) => t.status === "Escalated"),
    review: all.filter(inReview),
  };
  const ql = q.trim().toLowerCase();
  const prioRank = (p: Priority) => PRIORITIES.indexOf(p);
  const rows = byTab[tab]
    .filter((t) => !ql || [t.id, t.tenant, t.title, t.unit, locationName(ws, t.locationId), userName(ws, t.assigneeId)].some((s) => s.toLowerCase().includes(ql)))
    .filter((t) => (!status || t.status === status) && (!prio || t.priority === prio) && (!cat || t.categoryId === cat))
    .sort((a, b) => sort === "oldest" ? a.createdAt.localeCompare(b.createdAt)
      : sort === "priority" ? prioRank(a.priority) - prioRank(b.priority) || b.createdAt.localeCompare(a.createdAt)
      : sort === "sla" ? slaInfo(ws, a, now).remainingMins - slaInfo(ws, b, now).remainingMins
      : b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const filters = [
    status && { k: `Status: ${status}`, clear: () => setStatus("") },
    prio && { k: `Priority: ${prio}`, clear: () => setPrio("") },
    cat && { k: `Category: ${ws.categories.find((c) => c.id === cat)?.name}`, clear: () => setCat("") },
  ].filter(Boolean) as { k: string; clear: () => void }[];
  const tabs: [QueueTab, string][] = [["all", "All tickets"], ["unassigned", "Unassigned"], ["mine", "My tickets"], ["escalated", "Escalated"], ["review", "Pending review"]];

  return <div className="page-content">
    <div className="toolbar-panel">
      <div className="queue-tabs" role="tablist">{tabs.map(([id, label]) => <span key={id} role="tab" aria-selected={tab === id} className={`${tab === id ? "active" : ""} ${id === "review" && byTab.review.length ? "tab-alert" : ""}`} onClick={() => { setTab(id); setPage(1); }}>{label} <b>{byTab[id].length}</b></span>)}</div>
      {tab !== "review" && <>
        <div className="toolbar-row">
          <label className="table-search"><Icon name="search" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by ticket, tenant, property or staff" aria-label="Search tickets" /></label>
          <Button icon="filter" onClick={() => setShowFilters((v) => !v)}>Filters {filters.length > 0 && <Badge tone="blue">{filters.length}</Badge>}</Button>
          <div className="field-wrap"><select className="ent-input toolbar-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="newest">Created: newest</option><option value="oldest">Created: oldest</option><option value="priority">Priority: highest</option><option value="sla">SLA: least time left</option></select></div>
        </div>
        {showFilters && <div className="toolbar-row filter-row">
          <select className="ent-input" value={status} onChange={(e) => { setStatus(e.target.value as TicketStatus | ""); setPage(1); }} aria-label="Status filter"><option value="">Any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <select className="ent-input" value={prio} onChange={(e) => { setPrio(e.target.value as Priority | ""); setPage(1); }} aria-label="Priority filter"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
          <select className="ent-input" value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }} aria-label="Category filter"><option value="">Any category</option>{ws.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>}
        {filters.length > 0 && <div className="active-filters">{filters.map((f) => <span key={f.k}>{f.k} <b role="button" onClick={f.clear}>×</b></span>)}<strong role="button" onClick={() => { setStatus(""); setPrio(""); setCat(""); }}>Clear all</strong></div>}
      </>}
    </div>
    {tab === "review" ? <ReviewQueue tickets={byTab.review} all={all} onTicket={onTicket} /> :
      <Panel className="table-panel">
        <div className="table-scroll"><div className="ticket-table">
          <div className="ticket-row ticket-head"><span>Ticket ID</span><span>Tenant / Property</span><span>Unit</span><span>Category</span><span>Priority</span><span>Sentiment</span><span>Assigned staff</span><span>SLA</span><span>Status</span><span /></div>
          {shown.map((t) => <TicketRow key={t.id} t={t} onOpen={() => onTicket(t.id)} />)}
          {shown.length === 0 && <EmptyState icon="ticket" title={all.length === 0 ? "No tickets in this workspace yet" : "No tickets match"}>{all.length === 0 ? `Tickets for ${ws.customer.name} will appear here.` : "Try a different tab, search or filter."}</EmptyState>}
        </div></div>
        <div className="pagination"><span>{rows.length ? `Showing ${(cur - 1) * PAGE + 1}–${Math.min(cur * PAGE, rows.length)} of ${rows.length} tickets` : "0 tickets"}</span><div><Button disabled={cur <= 1} onClick={() => setPage(cur - 1)}>Previous</Button>{Array.from({ length: pages }, (_, i) => <span key={i} role="button" className={i + 1 === cur ? "page-number" : ""} onClick={() => setPage(i + 1)}>{i + 1}</span>)}<Button disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Next</Button></div></div>
      </Panel>}
  </div>;
}

function TicketRow({ t, onOpen }: { t: Ticket; onOpen: () => void }) {
  const { ws, now } = useWorkspace();
  const sla = slaInfo(ws, t, now);
  const staff = userName(ws, t.assigneeId);
  return <div className="ticket-row clickable" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
    <span><strong className="ticket-id">{t.id}</strong><small>{when(t.createdAt, now)}</small></span>
    <span><strong>{t.tenant}</strong><small>{locationName(ws, t.locationId)}</small></span><span>{t.unit}</span><span>{categoryOf(ws, t)?.name}</span>
    <span><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge></span>
    <span><Badge tone={sentimentTone(t.sentiment)} dot>{t.sentiment}</Badge></span>
    <span className="staff-cell"><i>{t.assigneeId ? initials(staff) : "TQ"}</i>{staff}</span>
    <span className={sla.state === "Breached" ? "danger-text" : sla.state === "At risk" ? "warning-text" : sla.state === "Met" ? "success-text" : ""}><strong>{sla.label}</strong></span>
    <span><Badge tone={statusTone(t.status)}>{t.status === "Pending Admin Review" ? "Pending review" : t.status}</Badge></span><span><Icon name="chevron" size={13} /></span>
  </div>;
}

/* ------------------------------------------------------------------ */
/* Admin review queue                                                  */
/* ------------------------------------------------------------------ */
type ReviewMode = "approve" | "reassign" | "reject";

function ReviewQueue({ tickets, all, onTicket }: { tickets: Ticket[]; all: Ticket[]; onTicket: (id: string) => void }) {
  const { ws, me, now, can } = useWorkspace();
  const [modal, setModal] = useState<{ id: string; mode: ReviewMode } | null>(null);
  const reviewer = can("review");
  const pending = [...tickets].sort((a, b) => pendingDecline(a)!.requestedAt.localeCompare(pendingDecline(b)!.requestedAt));
  const reviewed = all.flatMap((t) => t.declines.filter((d) => d.state !== "pending" && (reviewer || d.requestedById === me?.id)).map((d) => ({ t, d })))
    .sort((a, b) => (b.d.reviewedAt ?? "").localeCompare(a.d.reviewedAt ?? "")).slice(0, 8);
  const modalTicket = modal && ws.tickets.find((t) => t.id === modal.id);

  return <>
    <Panel>
      <PanelHeader title={reviewer ? "Pending admin review" : "My decline requests"} subtitle={reviewer ? `Decline requests from staff at your locations · ${ws.customer.name}` : "Requests you've submitted that are waiting for an administrator"} action={<Badge tone={pending.length ? "purple" : "green"}>{pending.length ? `${pending.length} awaiting decision` : "All clear"}</Badge>} />
      {pending.length === 0 && <EmptyState icon="check" title="No pending decline requests">{reviewer ? "When staff ask to decline a ticket it will appear here for approval." : "You have no requests waiting for review."}</EmptyState>}
      <div className="review-list-cards">
        {pending.map((t) => {
          const d = pendingDecline(t)!;
          return <div className="review-card" key={t.id}>
            <div className="review-ticket">
              <div className="ticket-kicker"><span className="ticket-id">{t.id}</span> · {locationName(ws, t.locationId).toUpperCase()}</div>
              <strong className="review-title">{t.title}</strong>
              <small>{t.tenant} · Unit {t.unit}</small>
              <div className="ent-chips"><Badge tone="teal">{categoryOf(ws, t)?.name}</Badge><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge><Badge tone="purple" dot>Pending Admin Review</Badge></div>
            </div>
            <div className="review-facts">
              <span><small>ORIGINAL ASSIGNEE</small><strong>{d.requestedByName}</strong></span>
              <span><small>SUBMITTED</small><strong>{when(d.requestedAt, now)}</strong><em>{fmtMins((now - Date.parse(d.requestedAt)) / 60000)} ago</em></span>
              <span className="review-reason"><small>DECLINE REASON</small><strong>{d.reasonLabel}</strong></span>
              <span className="review-reason"><small>ADDITIONAL EXPLANATION</small>{d.explanation ? <q>{d.explanation}</q> : <em>No explanation provided</em>}</span>
            </div>
            <div className="review-actions">
              <Button icon="file" onClick={() => onTicket(t.id)}>Open ticket</Button>
              {canReview(ws, me, t) ? <>
                <Button variant="danger" onClick={() => setModal({ id: t.id, mode: "reject" })}>Reject</Button>
                <Button onClick={() => setModal({ id: t.id, mode: "approve" })}><Icon name="check" />Approve</Button>
                <Button variant="primary" icon="route" onClick={() => setModal({ id: t.id, mode: "reassign" })}>Approve & reassign</Button>
              </> : <Note tone="purple">Awaiting an administrator. The ticket stays with you until then.</Note>}
            </div>
          </div>;
        })}
      </div>
    </Panel>
    <Panel className="ent-gap">
      <PanelHeader title="Recently reviewed" subtitle="Decisions are kept in each ticket's activity history" />
      <div className="table-scroll"><div className="ent-rows review-history">
        <div className="ent-row head"><span>Ticket</span><span>Requested by</span><span>Reason</span><span>Decision</span><span>Reviewed by</span><span>Outcome</span><span>When</span></div>
        {reviewed.length === 0 && <div className="ent-row"><span className="ent-muted">No decisions yet.</span></div>}
        {reviewed.map(({ t, d }) => <div className="ent-row ent-click-row" key={d.id} role="button" onClick={() => onTicket(t.id)}>
          <strong className="ticket-id">{t.id}</strong><span>{d.requestedByName}</span><span className="ent-muted">{d.reasonLabel}</span>
          <span><Badge tone={d.state === "approved" ? "green" : "red"}>{d.state === "approved" ? "Approved" : "Rejected"}</Badge></span>
          <span>{d.reviewedByName}</span><span className="ent-muted">{d.outcome}</span><span>{d.reviewedAt && when(d.reviewedAt, now)}</span>
        </div>)}
      </div></div>
    </Panel>
    {modal && modalTicket && <ReviewModal ticket={modalTicket} mode={modal.mode} onClose={() => setModal(null)} />}
  </>;
}

function DeclineSummary({ ticket, d }: { ticket: Ticket; d: DeclineRequest }) {
  const { ws, now } = useWorkspace();
  return <div className="modal-summary">
    <div className="ticket-kicker">{ticket.id} · {locationName(ws, ticket.locationId).toUpperCase()} · UNIT {ticket.unit}</div>
    <strong>{ticket.title}</strong>
    <div className="modal-summary-grid">
      <span><small>REQUESTED BY</small>{d.requestedByName} · {when(d.requestedAt, now)}</span>
      <span><small>REASON</small>{d.reasonLabel}</span>
      {d.explanation && <span className="span-2"><small>EXPLANATION</small><q>{d.explanation}</q></span>}
    </div>
  </div>;
}

export function ReviewModal({ ticket, mode, onClose }: { ticket: Ticket; mode: ReviewMode; onClose: () => void }) {
  const { ws, run } = useWorkspace();
  const d = pendingDecline(ticket);
  const rec = useMemo(() => topRecommendation(recommendStaff(ws, ticket)), [ws, ticket]);
  const [target, setTarget] = useState<AssignTarget>(mode === "reassign" && rec ? { kind: "user", userId: rec.user.id } : { kind: "queue" });
  const [comment, setComment] = useState("");
  const [tried, setTried] = useState(false);
  if (!d) return <Modal title="Review decline" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}><Note tone="green">This request has already been reviewed.</Note></Modal>;

  if (mode === "reject") {
    const err = comment.trim().length < 5 ? "A comment is required so the staff member knows why (at least 5 characters)." : null;
    const submit = () => { setTried(true); if (err) return; if (run((w, me, now) => rejectDecline(w, ticket.id, me, comment, now), `Decline rejected. ${d.requestedByName} has been notified and keeps ${ticket.id}.`).ok) onClose(); };
    return <Modal title="Reject decline request" subtitle={`The ticket returns to ${d.requestedByName} as “${d.previousStatus}”`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" onClick={submit}>Reject decline</Button></>}>
      <DeclineSummary ticket={ticket} d={d} />
      <label className="modal-field"><span>Comment to {d.requestedByName} <b className="req">required</b></span>
        <textarea className={`ent-input ent-textarea ${tried && err ? "invalid" : ""}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. You're the only plumber on shift. Please attend first and escalate if you need help." rows={4} />
        {tried && err && <small className="field-error">{err}</small>}
      </label>
    </Modal>;
  }

  const who = target.kind === "user" ? userName(ws, target.userId) : "";
  const submit = () => {
    const msg = target.kind === "queue" ? `Decline approved. ${ticket.id} is back in the team queue.` : target.userId === d.requestedById ? `Decline approved. ${ticket.id} stays with ${who}.` : `Decline approved. ${ticket.id} reassigned to ${who}.`;
    if (run((w, me, now) => approveDecline(w, ticket.id, me, target, comment, now), msg).ok) onClose();
  };
  return <Modal wide title={mode === "reassign" ? "Approve decline & reassign" : "Approve decline request"} subtitle="Choose where the ticket goes next" onClose={onClose}
    footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={submit}>{target.kind === "queue" ? "Approve & return to queue" : `Approve & assign to ${who}`}</Button></>}>
    <DeclineSummary ticket={ticket} d={d} />
    <AssignmentPicker ticket={ticket} value={target} onChange={setTarget} />
    <label className="modal-field"><span>Note for the record <em>optional</em></span>
      <textarea className="ent-input ent-textarea" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Shown in the activity history" />
    </label>
  </Modal>;
}

/* ------------------------------------------------------------------ */
/* Assignment picker with recommendations                              */
/* ------------------------------------------------------------------ */
function AssignmentPicker({ ticket, value, onChange, currentId }: { ticket: Ticket; value: AssignTarget; onChange: (t: AssignTarget) => void; currentId?: string | null }) {
  const { ws } = useWorkspace();
  const [showAll, setShowAll] = useState(false);
  const cands = recommendStaff(ws, ticket);
  const top = topRecommendation(cands);
  const selectedId = value.kind === "user" ? value.userId : null;
  const list = showAll ? cands : cands.filter((c) => c.eligible || c.isOriginal || c.user.id === selectedId || c.user.id === currentId);
  const selected = cands.find((c) => c.user.id === selectedId);
  const queued = ws.tickets.filter((t) => t.locationId === ticket.locationId && t.assigneeId === null && isActive(t)).length;
  const loc = locationName(ws, ticket.locationId);
  return <div className="assign-picker">
    <div className="assign-picker-head"><span>Assign to</span><small>Ranked on {categoryOf(ws, ticket)?.name} skill, assignment to {loc}, availability and open workload</small></div>
    <div className={`assign-option ${value.kind === "queue" ? "selected" : ""}`} role="radio" aria-checked={value.kind === "queue"} tabIndex={0} onClick={() => onChange({ kind: "queue" })} onKeyDown={(e) => e.key === "Enter" && onChange({ kind: "queue" })}>
      <span className="assign-radio" /><i className="avatar-small queue-avatar"><Icon name="users" size={13} /></i>
      <span className="assign-main"><strong>Team queue</strong><small>Any qualified staff member at {loc} can pick it up · {queued} already waiting</small></span>
    </div>
    {list.map((c) => {
      const on = c.user.id === selectedId;
      return <div key={c.user.id} className={`assign-option ${on ? "selected" : ""} ${c.eligible ? "" : "ineligible"}`} role="radio" aria-checked={on} tabIndex={0} onClick={() => onChange({ kind: "user", userId: c.user.id })} onKeyDown={(e) => e.key === "Enter" && onChange({ kind: "user", userId: c.user.id })}>
        <span className="assign-radio" /><i className="avatar-small">{initials(c.user.name)}</i>
        <span className="assign-main">
          <strong>{c.user.name} <em>{roleOf(ws, c.user)?.name}{c.user.team ? ` · ${c.user.team}` : ""}</em></strong>
          <span className="assign-reasons">{c.reasons.map((r) => <span key={r.text} className={r.ok ? "ok" : "no"}><Icon name={r.ok ? "check" : "x"} size={10} />{r.text}</span>)}</span>
        </span>
        <span className="assign-tags">
          {top?.user.id === c.user.id && <Badge tone="green">Recommended</Badge>}
          {c.isOriginal && <Badge tone="purple">Original assignee</Badge>}
          {currentId === c.user.id && !c.isOriginal && <Badge tone="blue">Current</Badge>}
          {!c.eligible && !c.isOriginal && <Badge tone="amber">Override</Badge>}
        </span>
      </div>;
    })}
    {!top && <Note tone="amber">No staff member fully matches this ticket&apos;s skill and location. Use the team queue, or show all staff to override.</Note>}
    <span className="text-link assign-toggle" role="button" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show recommended staff only" : `Show all ${cands.length} staff (override)`}</span>
    {selected && !selected.eligible && !selected.isOriginal && <Note tone="amber"><strong>Override:</strong> {selected.user.name} is not a recommended match ({selected.reasons.filter((r) => !r.ok).map((r) => r.text.toLowerCase()).join(", ")}). This is recorded in the activity history.</Note>}
  </div>;
}

function ReassignModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { ws, run } = useWorkspace();
  const rec = topRecommendation(recommendStaff(ws, ticket));
  const [target, setTarget] = useState<AssignTarget>(rec && rec.user.id !== ticket.assigneeId ? { kind: "user", userId: rec.user.id } : { kind: "queue" });
  const who = target.kind === "user" ? userName(ws, target.userId) : "the team queue";
  const submit = () => { if (run((w, me, now) => reassignTicket(w, ticket.id, me, target, now), `${ticket.id} assigned to ${who}.`).ok) onClose(); };
  return <Modal wide title={`Reassign ${ticket.id}`} subtitle={`Currently: ${userName(ws, ticket.assigneeId)}`} onClose={onClose}
    footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="route" onClick={submit}>Assign to {who}</Button></>}>
    <AssignmentPicker ticket={ticket} value={target} onChange={setTarget} currentId={ticket.assigneeId} />
  </Modal>;
}

/* ------------------------------------------------------------------ */
/* Decline modal (staff)                                               */
/* ------------------------------------------------------------------ */
export function DeclineModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { ws, run } = useWorkspace();
  const reasons = ws.declineReasons.filter((r) => r.active);
  const [reasonId, setReasonId] = useState("");
  const [explanation, setExplanation] = useState("");
  const [tried, setTried] = useState(false);
  const reason = reasons.find((r) => r.id === reasonId);
  const err = validateDecline(ws, { reasonId, explanation });
  const submit = () => {
    setTried(true);
    if (err) return;
    if (run((w, me, now) => requestDecline(w, ticket.id, me, { reasonId, explanation }, now), `Decline request sent. ${ticket.id} is now pending admin review.`).ok) onClose();
  };
  return <Modal title="Decline ticket" subtitle="Your request goes to an administrator for approval" onClose={onClose}
    footer={<><Button onClick={onClose}>Cancel</Button><Button variant="purple" icon="decline" disabled={reasons.length === 0} onClick={submit}>Submit decline request</Button></>}>
    <div className="modal-summary">
      <div className="ticket-kicker">{ticket.id} · {locationName(ws, ticket.locationId).toUpperCase()} · UNIT {ticket.unit}</div>
      <strong>{ticket.title}</strong>
      <small>{categoryOf(ws, ticket)?.name} · {ticket.priority} · {ticket.tenant}</small>
    </div>
    {reasons.length === 0 ? <Note tone="red"><strong>No decline reasons are configured.</strong> Ask an administrator to add them under Administration → Decline reasons.</Note> : <>
      <label className="modal-field"><span>Reason for declining <b className="req">required</b></span>
        <select className={`ent-input ${tried && !reason ? "invalid" : ""}`} value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
          <option value="">Select a reason…</option>
          {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        {tried && !reason && <small className="field-error">Select a reason.</small>}
      </label>
      <label className="modal-field"><span>Additional explanation {reason?.requiresExplanation ? <b className="req">required</b> : <em>optional</em>}</span>
        <textarea className={`ent-input ent-textarea ${tried && reason && err ? "invalid" : ""}`} rows={4} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Give the administrator context, e.g. what skill or equipment is needed" />
        <span className="modal-field-foot">{tried && reason && err ? <small className="field-error">{err}</small> : <small>{reason?.requiresExplanation ? "At least 10 characters." : " "}</small>}<small>{explanation.trim().length} characters</small></span>
      </label>
    </>}
    <Note tone="purple"><strong>The ticket stays assigned to you</strong> and shows as Pending Admin Review until an administrator approves or rejects the request. Admins for {locationName(ws, ticket.locationId)} are notified.</Note>
  </Modal>;
}

/* ------------------------------------------------------------------ */
/* Ticket detail                                                       */
/* ------------------------------------------------------------------ */
type DetailModal = ReviewMode | "decline" | "reassign" | "resolve" | "escalate" | null;

export function TicketDetail({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const { ws, me, now, can, run } = useWorkspace();
  const [modal, setModal] = useState<DetailModal>(null);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const t = ws.tickets.find((x) => x.id === ticketId);

  if (!t || !canSeeTicket(ws, me, t)) return <div className="page-content">
    <div className="detail-toolbar"><span className="back-link" role="button" onClick={onBack}>‹ All tickets</span></div>
    <Panel><EmptyState icon="lock" title="Ticket not available" action={<Button onClick={onBack}>Back to tickets</Button>}>{ticketId} isn&apos;t in {ws.customer.name}, or it belongs to a location you don&apos;t have access to.</EmptyState></Panel>
  </div>;

  const pending = pendingDecline(t);
  const last = lastDecline(t);
  const sla = slaInfo(ws, t, now);
  const assignee = userById(ws, t.assigneeId);
  const cands = recommendStaff(ws, t);
  const backup = cands.find((c) => c.eligible && c.user.id !== t.assigneeId);
  const manager = ws.users.find((u) => u.roleId === "t1" && u.locationIds.includes(t.locationId)) ?? ws.users.find((u) => u.roleId === "regional" && u.locationIds.includes(t.locationId));
  const mine = !!me && t.assigneeId === me.id;
  const active = t.status !== "Resolved";
  const remain = Math.max(0, sla.remainingMins);
  const timer = `${String(Math.floor(remain / 60)).padStart(2, "0")}:${String(Math.floor(remain % 60)).padStart(2, "0")}:${String(Math.floor((remain * 60) % 60)).padStart(2, "0")}`;
  const cat = categoryOf(ws, t);

  return <div className="page-content">
    <div className="detail-toolbar">
      <span className="back-link" role="button" onClick={onBack}>‹ All tickets</span>
      <div className="detail-actions">
        {canDecline(ws, me, t) && <Button variant="purple" icon="decline" onClick={() => setModal("decline")}>Decline ticket</Button>}
        {mine && t.status === "Open" && <Button icon="check" onClick={() => run((w, m, n) => startWork(w, t.id, m, n), `Work started on ${t.id}.`)}>Start work</Button>}
        {t.assigneeId === null && active && me && isStaffRole(ws, me) && <Button icon="inbox" onClick={() => run((w, m, n) => takeFromQueue(w, t.id, m, n), `${t.id} is now assigned to you.`)}>Take ticket</Button>}
        {can("reassign") && active && !pending && <Button icon="route" onClick={() => setModal("reassign")}>Reassign</Button>}
        {active && !pending && t.status !== "Escalated" && <Button variant="danger" onClick={() => setModal("escalate")}>Escalate</Button>}
        <Button onClick={() => noteRef.current?.focus()}>Add note</Button>
        {active && (can("edit") || mine) && <Button variant="primary" disabled={!!pending} title={pending ? "Resolve the pending decline request first" : undefined} onClick={() => setModal("resolve")}><Icon name="check" />Resolve</Button>}
      </div>
    </div>
    <div className="ticket-summary">
      <div><div className="ticket-kicker">{t.id} · CREATED {when(t.createdAt, now).toUpperCase()}</div><div className="detail-title">{t.title}</div><div className="detail-subtitle">{t.tenant} · {locationName(ws, t.locationId)}, Unit {t.unit} · {t.channel}</div></div>
      <div className="summary-badges"><Badge tone={statusTone(t.status)} dot>{t.status}</Badge><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge><Badge tone={sentimentTone(t.sentiment)} dot>{t.sentiment}</Badge></div>
    </div>

    {pending && <div className="review-banner">
      <span className="review-banner-icon"><Icon name="clock" /></span>
      <div>
        <strong>Pending admin review: {pending.requestedByName} asked to decline this ticket</strong>
        <span>{when(pending.requestedAt, now)} · Reason: <b>{pending.reasonLabel}</b>{pending.explanation && <> · <q>{pending.explanation}</q></>}</span>
        <small>{pending.requestedById === me?.id ? "It stays assigned to you until an administrator approves or rejects the request." : `${pending.requestedByName} remains the assignee until a decision is made.`}</small>
      </div>
      {canReview(ws, me, t) && <div className="review-banner-actions"><Button variant="danger" onClick={() => setModal("reject")}>Reject</Button><Button onClick={() => setModal("approve")}>Approve</Button><Button variant="primary" icon="route" onClick={() => setModal("reassign" as ReviewMode)}>Approve & reassign</Button></div>}
    </div>}
    {!pending && last?.state === "rejected" && active && t.assigneeId === last.requestedById && <div className="detail-note"><Note tone="amber"><strong>{last.requestedById === me?.id ? "Your decline request was rejected" : `Decline request from ${last.requestedByName} was rejected`}</strong> by {last.reviewedByName} · {last.reviewedAt && when(last.reviewedAt, now)}. <q>{last.reviewComment}</q></Note></div>}
    {!pending && last?.state === "approved" && active && <div className="detail-note"><Note tone="green"><strong>Decline approved</strong> by {last.reviewedByName} · {last.reviewedAt && when(last.reviewedAt, now)}. {last.outcome}.</Note></div>}

    <div className="detail-grid">
      <div className="detail-main">
        <Panel>
          <PanelHeader title="Issue notes" action={<Badge tone="slate">Staff action</Badge>} />
          <p className="body-copy">{t.description || "No notes were captured."}</p>
          <div className="note-meta"><span className="avatar-small">{initials(t.history.at(-1)?.actorName ?? "HD")}</span><span><strong>{t.history.at(-1)?.actorName}</strong><small>Logged · {when(t.createdAt, now)}</small></span><span className="ent-muted">{t.contact}</span></div>
        </Panel>
        <Panel>
          <PanelHeader title="Activity timeline" subtitle="Complete audit trail" action={<Badge tone="slate">{t.history.length} events</Badge>} />
          <ActivityTimeline ticket={t} />
          <div className="add-note">
            <textarea ref={noteRef} className="textarea note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note or update…" aria-label="Internal note" />
            <div><span>Visible to staff only</span><Button variant="primary" disabled={!note.trim()} onClick={() => { if (run((w, m, n) => addNote(w, t.id, m, note, n), "Note added.").ok) setNote(""); }}>Add note</Button></div>
          </div>
        </Panel>
      </div>
      <div className="detail-side">
        <Panel className="sla-card">
          <PanelHeader title="SLA timer" action={<Badge tone={slaTone(sla.state === "Met" ? "Within" : sla.state)}>{sla.state}</Badge>} />
          <div className={`timer ${sla.state === "Breached" ? "danger-text" : sla.state === "Within SLA" || sla.state === "Met" ? "success-text" : ""}`}>{sla.state === "Breached" ? `+${fmtMins(sla.remainingMins)}` : sla.state === "Met" ? "Met" : timer}</div>
          <div className="timer-caption">{sla.state === "Breached" ? "past resolution target" : sla.state === "Met" ? "resolved within target" : "until resolution breach"} · Due {clock(new Date(sla.dueAt).toISOString())}{day(new Date(sla.dueAt).toISOString(), now) !== "Today" ? ` ${day(new Date(sla.dueAt).toISOString(), now)}` : ""}</div>
          <div className="progress"><i style={{ width: `${sla.pctElapsed}%`, background: sla.state === "Breached" ? "var(--red)" : sla.state === "At risk" ? "#d79324" : "var(--green)" }} /></div>
          <div className="timer-meta"><span>{sla.pctElapsed}% elapsed</span><span>{sla.policy}</span></div>
          {t.status === "Pending Admin Review" && <div className="timer-meta"><span className="warning-text">SLA keeps running while the decline is reviewed.</span></div>}
        </Panel>
        <Panel>
          <PanelHeader title="AI enrichment" action={<Badge tone="purple"><Icon name="spark" size={12} />Sample data</Badge>} />
          <div className="info-list"><span><small>CATEGORY</small><strong>{cat?.name}</strong></span><span><small>SENTIMENT</small><strong className={t.sentiment === "Negative" ? "danger-text" : t.sentiment === "Positive" ? "success-text" : ""}>{t.sentiment}</strong></span><span><small>PRIORITY</small><strong>{t.priority}</strong></span></div>
          {t.tags.length > 0 && <div className="tag-list">{t.tags.map((g, i) => <Badge key={g} tone={i === 0 ? "red" : "amber"}>{g}</Badge>)}</div>}
        </Panel>
        <Panel>
          <PanelHeader title="Allocation" action={<Badge tone="teal">{t.assigneeId ? "Assigned" : "Team queue"}</Badge>} />
          <div className="assignee"><span className="avatar-large small">{assignee ? initials(assignee.name) : "TQ"}</span><span><small>PRIMARY ASSIGNEE</small><strong>{userName(ws, t.assigneeId)}</strong>{assignee ? <em className={`avail-${availTone(assignee.availability)}`}><i />{assignee.availability} · {cands.find((c) => c.user.id === assignee.id)?.open ?? 0} open</em> : <em className="avail-amber"><i />Waiting for pickup at {locationName(ws, t.locationId)}</em>}</span></div>
          <div className="backup"><span>Backup</span><strong>{backup?.user.name ?? "None eligible"}</strong><span>Manager</span><strong>{manager?.name ?? "—"}</strong></div>
        </Panel>
        <Panel>
          <PanelHeader title="Linked records" />
          <div className="linked-list"><span><Icon name="person" /><i><strong>{t.tenant}</strong><small>Resident · {t.contact}</small></i></span><span><Icon name="building" /><i><strong>{locationName(ws, t.locationId)} · {t.unit}</strong><small>Location & unit</small></i></span><span><Icon name="shield" /><i><strong>{ws.customer.name}</strong><small>Customer workspace · Zongovita</small></i></span></div>
        </Panel>
      </div>
    </div>

    {modal === "decline" && <DeclineModal ticket={t} onClose={() => setModal(null)} />}
    {(modal === "approve" || modal === "reject") && <ReviewModal ticket={t} mode={modal} onClose={() => setModal(null)} />}
    {modal === "reassign" && (pending ? <ReviewModal ticket={t} mode="reassign" onClose={() => setModal(null)} /> : <ReassignModal ticket={t} onClose={() => setModal(null)} />)}
    {modal === "resolve" && <ConfirmDialog title={`Resolve ${t.id}?`} body={<>The ticket will be marked resolved and its SLA timer stops. {t.tenant} would be notified once messaging is connected.</>} confirm="Resolve ticket" onConfirm={() => run((w, m, n) => resolveTicket(w, t.id, m, n), `${t.id} resolved.`)} onClose={() => setModal(null)} />}
    {modal === "escalate" && <ConfirmDialog title={`Escalate ${t.id}?`} tone="danger" body={<>This starts the {cat?.name} escalation chain for {ws.customer.name} and notifies Level 1.</>} confirm="Escalate" onConfirm={() => run((w, m, n) => escalateTicket(w, t.id, m, n), `${t.id} escalated.`)} onClose={() => setModal(null)} />}
  </div>;
}

const SOURCE: Record<EventSource, [string, string, "blue" | "purple" | "teal" | "slate" | "red"]> = {
  crm: ["CRM data", "crm", "slate"], ai: ["AI generated", "ai", "purple"], system: ["System generated", "system", "teal"], staff: ["Staff action", "", "blue"], manager: ["Manager action", "manager", "red"],
};

export function ActivityTimeline({ ticket }: { ticket: Ticket }) {
  const { now } = useWorkspace();
  return <div className="timeline">{ticket.history.map((e) => {
    const [label, dot, tone] = SOURCE[e.source];
    return <div className="timeline-item" key={e.id}>
      <span className={`timeline-dot ${dot}`} /><span className="timeline-time">{clock(e.at)}</span>
      <span><Badge tone={tone}>{label}</Badge><strong>{e.text}</strong>{e.detail && <q className="timeline-detail">{e.detail}</q>}<small>{day(e.at, now)} · {e.actorName}</small></span>
    </div>;
  })}</div>;
}

/* ------------------------------------------------------------------ */
/* Create ticket                                                       */
/* ------------------------------------------------------------------ */
const SIGNALS: [RegExp, string][] = [
  [/no heat|boiler|cold|freez/i, "No heating"], [/child|baby|elderly|disab|pregnan|senior/i, "Vulnerable occupant"],
  [/leak|flood|water|drip|overflow/i, "Water damage"], [/spark|smoke|fire|burn|shock/i, "Safety risk"],
  [/stuck|trapped/i, "Person or lift stuck"], [/urgent|asap|immediately|emergency/i, "Urgency expressed"],
];
/** SIMULATED AI: keyword rules standing in for the real classification model. */
function simulateAi(text: string): { tags: string[]; sentiment: Sentiment; priority: Priority } {
  const tags = SIGNALS.filter(([re]) => re.test(text)).map(([, t]) => t);
  const neg = (text.match(/\b(not|no|never|again|still|angry|unacceptable|frustrat|worst|urgent)\w*/gi) ?? []).length;
  const pos = (text.match(/\b(thank|appreciat|great|happy|please)\w*/gi) ?? []).length;
  const sentiment: Sentiment = neg >= 2 && neg > pos ? "Negative" : pos > neg ? "Positive" : "Neutral";
  const priority: Priority = tags.some((t) => ["Safety risk", "Vulnerable occupant", "Person or lift stuck"].includes(t)) ? "Urgent" : tags.length ? "High" : "Normal";
  return { tags, sentiment, priority };
}

export function CreateTicket({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const { ws, me, myLocationIds, locationId, run, now } = useWorkspace();
  const locs = ws.locations.filter((l) => myLocationIds.includes(l.id));
  const [f, setF] = useState({ tenant: "", contact: "", unit: "", channel: "Inbound call", title: "", description: "", locationId: locationId !== "all" ? locationId : locs[0]?.id ?? "", categoryId: ws.categories[0]?.id ?? "", priority: "" as Priority | "" });
  const [assign, setAssign] = useState("auto");
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const ai = simulateAi(`${f.title} ${f.description}`);
  const priority = (f.priority || ai.priority) as Priority;
  const draft: Ticket = { id: "draft", title: f.title, description: f.description, tenant: f.tenant, contact: f.contact, channel: f.channel, locationId: f.locationId, unit: f.unit, categoryId: f.categoryId, priority, sentiment: ai.sentiment, tags: ai.tags, assigneeId: null, status: "Open", createdAt: new Date(now).toISOString(), declines: [], history: [] };
  const cands = recommendStaff(ws, draft);
  const rec = topRecommendation(cands);
  const second = cands.find((c) => c.eligible && c.user.id !== rec?.user.id);
  const sla = slaInfo(ws, draft, now);
  const target: AssignTarget = assign === "queue" ? { kind: "queue" } : assign === "auto" ? (rec ? { kind: "user", userId: rec.user.id } : { kind: "queue" }) : { kind: "user", userId: assign };
  const suggestedCat = ws.categories.find((c) => new RegExp(c.name.split(/[ &]/)[0], "i").test(`${f.title} ${f.description}`));

  if (!locs.length || !me) return <div className="page-content"><Panel><EmptyState icon="lock" title="You can't create tickets here">Your role has no locations assigned in {ws.customer.name}.</EmptyState></Panel></div>;

  const submit = () => {
    setErr(null);
    const r = run((w, m, n) => createTicket(w, m, { ...f, priority, sentiment: ai.sentiment, tags: ai.tags, target }, n));
    if (r.ok && r.ticketId) onCreated(r.ticketId); else if (!r.ok) setErr(r.error);
  };
  const lbl = (s: string, req = false) => <div className="field-label">{s}{req && <b className="req">*</b>}</div>;

  return <div className="page-content create-layout">
    <div className="create-main">
      <Panel>
        <PanelHeader title="Resident & location" subtitle={`Ticket is created in ${ws.customer.name}`} action={<Badge tone="blue">CRM data</Badge>} />
        <div className="form-grid">
          <div className="field-wrap">{lbl("Resident name", true)}<input className="ent-input" value={f.tenant} onChange={set("tenant")} placeholder="e.g. Ananya Krishnan" /></div>
          <div className="field-wrap">{lbl("Contact number")}<input className="ent-input" value={f.contact} onChange={set("contact")} placeholder="+91 98450 00000" /></div>
          <div className="field-wrap">{lbl("Location", true)}<select className="ent-input" value={f.locationId} onChange={set("locationId")}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div className="field-wrap">{lbl("Unit", true)}<input className="ent-input" value={f.unit} onChange={set("unit")} placeholder="e.g. T4-1203" /></div>
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Call details" subtitle="Capture the resident's issue and contact context" />
        <div className="form-grid">
          <div className="field-wrap">{lbl("Issue title", true)}<input className="ent-input" value={f.title} onChange={set("title")} placeholder="Short summary" /></div>
          <div className="field-wrap">{lbl("Contact channel")}<select className="ent-input" value={f.channel} onChange={set("channel")}>{["Inbound call", "Resident app", "Email", "Walk-in", "Tenant portal"].map((c) => <option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="notes-field"><div className="field-label">Call notes</div><textarea className="textarea note-input" value={f.description} onChange={set("description")} placeholder="What did the resident report?" /><div className="notes-footer"><span>{f.description.length} characters</span><span>Not saved until you create the ticket</span></div></div>
      </Panel>
      <Panel>
        <PanelHeader title="Allocation" subtitle="Routing based on location, category and current staff availability" action={<Badge tone="teal">System generated</Badge>} />
        <div className="route-flow"><div><small>LOCATION</small><strong>{locationName(ws, f.locationId)}</strong></div><Icon name="chevron" /><div><small>CATEGORY</small><strong>{ws.categories.find((c) => c.id === f.categoryId)?.name}</strong></div><Icon name="chevron" /><div className="selected-route"><small>PRIMARY</small><strong>{rec?.user.name ?? "Team queue"}</strong><span>{rec ? `${rec.user.availability} · ${rec.open} open` : "No eligible staff"}</span></div><Icon name="chevron" /><div><small>BACKUP</small><strong>{second?.user.name ?? "—"}</strong><span>{second ? `${second.user.availability} · ${second.open} open` : " "}</span></div></div>
        <div className="form-grid"><div className="field-wrap">{lbl("Assign to")}<select className="ent-input" value={assign} onChange={(e) => setAssign(e.target.value)}>
          <option value="auto">Recommended{rec ? ` (${rec.user.name})` : " (team queue)"}</option><option value="queue">Team queue</option>
          {cands.map((c) => <option key={c.user.id} value={c.user.id}>{c.user.name}{c.eligible ? "" : " (override)"}</option>)}
        </select></div></div>
      </Panel>
    </div>
    <div className="create-side">
      <Panel className="ai-analysis">
        <PanelHeader title="AI analysis" subtitle="Generated from call notes" action={<Badge tone="purple"><Icon name="spark" size={12} />Simulated</Badge>} />
        <div className="analysis-status"><span className="ai-icon"><Icon name="spark" /></span><span><strong>{f.description || f.title ? "Analysis updated" : "Waiting for notes"}</strong>Keyword rules stand in for the AI model in this prototype</span></div>
        <div className="analysis-item"><small>SUGGESTED CATEGORY</small><strong>{suggestedCat?.name ?? "No match yet"}</strong>{suggestedCat && suggestedCat.id !== f.categoryId && <span className="text-link" role="button" onClick={() => setF((p) => ({ ...p, categoryId: suggestedCat.id }))}>Use this category</span>}</div>
        <div className="analysis-item"><small>SENTIMENT</small><strong className={ai.sentiment === "Negative" ? "danger-text" : ""}>{ai.sentiment}</strong></div>
        <div className="analysis-item"><small>URGENCY SIGNALS</small><div className="tag-list">{ai.tags.length ? ai.tags.map((g) => <Badge key={g} tone="amber">{g}</Badge>) : <span className="ent-muted">None detected</span>}</div></div>
        <div className="recommendation"><strong>Recommended priority: {ai.priority}</strong><span>{ai.tags.length ? `Based on: ${ai.tags.join(", ").toLowerCase()}.` : "No urgency signals in the notes."}</span></div>
      </Panel>
      <Panel>
        <PanelHeader title="Ticket settings" />
        <div className="field-wrap">{lbl("Category", true)}<select className="ent-input" value={f.categoryId} onChange={set("categoryId")}>{ws.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field-wrap">{lbl("Priority")}<select className="ent-input" value={f.priority} onChange={set("priority")}><option value="">Use AI recommendation ({ai.priority})</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="sla-preview"><span>RESOLUTION DUE</span><strong>{when(new Date(sla.dueAt).toISOString(), now)}</strong><small>{fmtMins(sla.totalMins)} · {sla.policy}</small></div>
      </Panel>
      {err && <Note tone="red">{err}</Note>}
      <div className="form-actions"><Button onClick={onCancel}>Cancel</Button><Button variant="primary" icon="plus" onClick={submit}>Create & assign ticket</Button></div>
    </div>
  </div>;
}
