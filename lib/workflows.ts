import { ACTIVE_STATUSES, type DeclineRequest, type ModuleKey, type RegistryEntry, type EventSource, type EventType, type Notification, type PermKey, type Priority, type Sentiment, type Ticket, type TicketEvent, type User, type Workspace } from "./model.ts";

/* Pure workflow functions. Every mutation takes a Workspace and returns a
   new one, so a customer's data can only ever change inside its own
   workspace. When a backend arrives, each of these maps to one API call. */

export type Result = { ok: true; ws: Workspace; ticketId?: string } | { ok: false; error: string };
export type AssignTarget = { kind: "queue" } | { kind: "user"; userId: string };

let seq = 0;
export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const iso = (now: number) => new Date(now).toISOString();
const fail = (error: string): Result => ({ ok: false, error });

export const fmtMins = (m: number) => {
  m = Math.round(Math.abs(m));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return `${d}d${h ? ` ${h}h` : ""}`;
};
export const initials = (n: string) => n.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();

/* ------------------------------------------------------------------ */
/* Licence (checked on every request)                                  */
/* ------------------------------------------------------------------ */
export type LicenceCheck = { ok: true; daysLeft: number } | { ok: false; reason: string };

/** Rule 4: if the licence has expired, all of that customer's sites are blocked. */
export function checkLicence(entry: RegistryEntry | undefined, now: number): LicenceCheck {
  if (!entry) return { ok: false, reason: "This customer is not in the Licence Registry." };
  const end = Date.parse(`${entry.licence.validUntil}T23:59:59`);
  const daysLeft = Math.floor((end - now) / 86400000);
  return end < now ? { ok: false, reason: `The ${entry.name} licence expired on ${entry.licence.validUntil}. All ${entry.licence.maxSites} licensed sites are blocked until it is renewed.` } : { ok: true, daysLeft };
}
export const hasModule = (entry: RegistryEntry | undefined, m: ModuleKey) => !!entry?.licence.modules.includes(m);
export const siteLimitReached = (entry: RegistryEntry | undefined, ws: Workspace) => !!entry && ws.locations.length >= entry.licence.maxSites;

/* ------------------------------------------------------------------ */
/* Lookups and simulated access control                                */
/* ------------------------------------------------------------------ */
export const userById = (ws: Workspace, id: string | null | undefined) => (id ? ws.users.find((u) => u.id === id) : undefined);
export const userName = (ws: Workspace, id: string | null | undefined) => (id ? userById(ws, id)?.name ?? "Former staff member" : "Team queue");
export const locationName = (ws: Workspace, id: string) => ws.locations.find((l) => l.id === id)?.name ?? "Unknown location";
export const categoryOf = (ws: Workspace, t: Ticket) => ws.categories.find((c) => c.id === t.categoryId);
export const roleOf = (ws: Workspace, u: User | undefined) => (u ? ws.roles.find((r) => r.id === u.roleId) : undefined);
export const isStaffRole = (ws: Workspace, u: User) => roleOf(ws, u)?.kind === "tier";

/** The user must belong to this workspace; role ids like "super" exist in every customer. */
const isMember = (ws: Workspace, u: User | undefined): u is User => !!u && ws.users.some((x) => x.id === u.id);

/** SIMULATED: frontend-only permission check, not a security control. */
export const can = (ws: Workspace, u: User | undefined, perm: PermKey) => isMember(ws, u) && !!ws.perms[u.roleId]?.[perm];

export function accessibleLocationIds(ws: Workspace, u: User | undefined): string[] {
  if (!isMember(ws, u)) return [];
  const all = ws.locations.map((l) => l.id);
  return roleOf(ws, u)?.scope === "all" ? all : all.filter((id) => u.locationIds.includes(id));
}

export function visibleTickets(ws: Workspace, u: User | undefined, locationFilter = "all"): Ticket[] {
  if (!can(ws, u, "view")) return [];
  const locs = accessibleLocationIds(ws, u).filter((id) => locationFilter === "all" || id === locationFilter);
  return ws.tickets.filter((t) => locs.includes(t.locationId));
}

export const canSeeTicket = (ws: Workspace, u: User | undefined, t: Ticket) => can(ws, u, "view") && accessibleLocationIds(ws, u).includes(t.locationId);
export const isActive = (t: Ticket) => ACTIVE_STATUSES.includes(t.status);
export const openCount = (ws: Workspace, userId: string) => ws.tickets.filter((t) => t.assigneeId === userId && isActive(t)).length;
export const pendingDecline = (t: Ticket): DeclineRequest | undefined => t.declines.find((d) => d.state === "pending");
export const lastDecline = (t: Ticket): DeclineRequest | undefined => t.declines[t.declines.length - 1];
export const canReview = (ws: Workspace, u: User | undefined, t: Ticket) => can(ws, u, "review") && accessibleLocationIds(ws, u).includes(t.locationId);
export const canDecline = (ws: Workspace, u: User | undefined, t: Ticket) =>
  !!u && can(ws, u, "decline") && t.assigneeId === u.id && t.status !== "Pending Admin Review" && t.status !== "Resolved";

/* ------------------------------------------------------------------ */
/* SLA                                                                 */
/* ------------------------------------------------------------------ */
export type SlaState = "Within SLA" | "At risk" | "Breached" | "Met";
export type SlaInfo = { state: SlaState; totalMins: number; remainingMins: number; pctElapsed: number; dueAt: number; label: string; policy: string };

export function slaInfo(ws: Workspace, t: Ticket, now: number): SlaInfo {
  const cat = categoryOf(ws, t);
  const totalMins = Math.max(1, Math.round((cat?.resolveMins ?? 480) * (ws.multipliers[t.priority] ?? 1)));
  const dueAt = Date.parse(t.createdAt) + totalMins * 60000;
  const end = t.status === "Resolved" && t.resolvedAt ? Date.parse(t.resolvedAt) : now;
  const remainingMins = (dueAt - end) / 60000;
  const pctElapsed = Math.min(100, Math.max(0, Math.round(((totalMins - remainingMins) / totalMins) * 100)));
  const policy = `${cat?.name ?? "Standard"} · ${t.priority} · ${fmtMins(totalMins)}`;
  let state: SlaState;
  if (t.status === "Resolved") state = remainingMins >= 0 ? "Met" : "Breached";
  else state = remainingMins < 0 ? "Breached" : remainingMins <= totalMins * 0.35 ? "At risk" : "Within SLA";
  const label = state === "Met" ? "Met" : state === "Breached" ? `Breached ${fmtMins(remainingMins)}` : state === "At risk" ? `At risk ${fmtMins(remainingMins)}` : fmtMins(remainingMins);
  return { state, totalMins, remainingMins, pctElapsed, dueAt, label, policy };
}

/* ------------------------------------------------------------------ */
/* Staff recommendations                                               */
/* ------------------------------------------------------------------ */
export type Candidate = { user: User; score: number; eligible: boolean; isOriginal: boolean; open: number; reasons: { ok: boolean; text: string }[] };

/** Ranks staff for a ticket on skill, location assignment, availability and live workload. */
export function recommendStaff(ws: Workspace, t: Ticket): Candidate[] {
  const cat = categoryOf(ws, t);
  const loc = locationName(ws, t.locationId);
  const original = pendingDecline(t)?.requestedById ?? lastDecline(t)?.requestedById;
  return ws.users.filter((u) => isStaffRole(ws, u)).map((u) => {
    const skill = !!cat && u.skills.includes(cat.name);
    const atLoc = u.locationIds.includes(t.locationId);
    const open = openCount(ws, u.id);
    const isOriginal = u.id === original;
    const reasons = [
      { ok: skill, text: skill ? `${cat!.name} skill` : `No ${cat?.name ?? "category"} skill` },
      { ok: atLoc, text: atLoc ? `Assigned to ${loc}` : `Not assigned to ${loc}` },
      { ok: u.availability !== "Unavailable", text: u.availability },
      { ok: open <= 4, text: `${open} open ticket${open === 1 ? "" : "s"}` },
    ];
    if (isOriginal) reasons.push({ ok: false, text: "Requested to decline" });
    const eligible = skill && atLoc && u.availability !== "Unavailable";
    const score = (skill ? 40 : 0) + (atLoc ? 30 : 0) + (u.availability === "Available" ? 20 : u.availability === "On call" ? 10 : -30) - open * 4 - (isOriginal ? 25 : 0);
    return { user: u, score, eligible, isOriginal, open, reasons };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

/** The best eligible candidate who did not decline the ticket. */
export const topRecommendation = (cands: Candidate[]) => cands.find((c) => c.eligible && !c.isOriginal);

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */
function patchTicket(ws: Workspace, id: string, fn: (t: Ticket) => Ticket, notes: Omit<Notification, "id" | "readBy">[] = []): Workspace {
  return {
    ...ws,
    tickets: ws.tickets.map((t) => (t.id === id ? fn(t) : t)),
    notifications: [...notes.map((n) => ({ ...n, id: uid("n"), readBy: [] })), ...ws.notifications],
  };
}
const event = (now: number, type: EventType, source: EventSource, actorName: string, text: string, detail?: string): TicketEvent =>
  ({ id: uid("e"), at: iso(now), type, source, actorName, text, detail: detail || undefined });
const withEvents = (t: Ticket, ...evs: TicketEvent[]): TicketEvent[] => [...evs.reverse(), ...t.history];
const sourceFor = (ws: Workspace, u: User): EventSource => (isStaffRole(ws, u) && !can(ws, u, "review") ? "staff" : "manager");

export type DeclineInput = { reasonId: string; explanation: string };

export function validateDecline(ws: Workspace, input: DeclineInput): string | null {
  const reason = ws.declineReasons.find((r) => r.id === input.reasonId && r.active);
  if (!reason) return "Select a reason for declining.";
  if (reason.requiresExplanation && input.explanation.trim().length < 10) return `"${reason.label}" needs an explanation of at least 10 characters.`;
  return null;
}

/** Staff asks to decline. The ticket stays with them until an admin decides. */
export function requestDecline(ws: Workspace, ticketId: string, actor: User, input: DeclineInput, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t) return fail("Ticket not found.");
  if (!canDecline(ws, actor, t)) return fail("Only the assigned staff member can decline an active ticket.");
  const err = validateDecline(ws, input);
  if (err) return fail(err);
  const reason = ws.declineReasons.find((r) => r.id === input.reasonId)!;
  const req: DeclineRequest = {
    id: uid("d"), reasonId: reason.id, reasonLabel: reason.label, explanation: input.explanation.trim(),
    requestedById: actor.id, requestedByName: actor.name, requestedAt: iso(now), previousStatus: t.status, state: "pending",
  };
  return {
    ok: true,
    ws: patchTicket(ws, t.id, (x) => ({
      ...x, status: "Pending Admin Review", declines: [...x.declines, req],
      history: withEvents(x,
        event(now, "decline_requested", "staff", actor.name, `${actor.name} requested to decline this ticket`),
        event(now, "decline_reason", "staff", actor.name, `Decline reason submitted: ${reason.label}`, req.explanation)),
    }), [{ at: iso(now), title: `Decline request · ${t.id}`, body: `${actor.name}: ${reason.label}`, ticketId: t.id, locationId: t.locationId, toPerm: "review" }]),
  };
}

function assignmentOutcome(ws: Workspace, t: Ticket, target: AssignTarget, original: string | null, now: number, actor: User, prevStatus: Ticket["status"]) {
  if (target.kind === "queue") {
    return { assigneeId: null, status: "Open" as const, outcome: "Returned to team queue", ev: event(now, "queued", "manager", actor.name, "Ticket returned to team queue") };
  }
  const u = userById(ws, target.userId)!;
  const same = target.userId === original;
  return {
    assigneeId: u.id,
    status: same ? prevStatus : ("Open" as const),
    outcome: same ? `Kept with ${u.name}` : `Reassigned to ${u.name}`,
    ev: event(now, "reassigned", "manager", actor.name, same ? `Ticket assigned back to ${u.name}` : `Ticket reassigned to ${u.name}`, original && !same ? `Previously ${userName(ws, original)}` : undefined),
  };
}

/** Admin approves the decline and routes the ticket: team queue, the original assignee, or someone else. */
export function approveDecline(ws: Workspace, ticketId: string, actor: User, target: AssignTarget, comment: string, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t) return fail("Ticket not found.");
  const req = pendingDecline(t);
  if (!req) return fail("There is no pending decline request on this ticket.");
  if (!canReview(ws, actor, t)) return fail("You do not have permission to review declines at this location.");
  if (target.kind === "user" && !userById(ws, target.userId)) return fail("Select a staff member from this workspace.");
  const o = assignmentOutcome(ws, t, target, req.requestedById, now, actor, req.previousStatus);
  const notes: Omit<Notification, "id" | "readBy">[] = [
    { at: iso(now), title: `Decline approved · ${t.id}`, body: `${actor.name}: ${o.outcome}`, ticketId: t.id, locationId: t.locationId, toUserIds: [req.requestedById] },
  ];
  if (o.assigneeId && o.assigneeId !== req.requestedById) notes.push({ at: iso(now), title: `Ticket assigned to you · ${t.id}`, body: t.title, ticketId: t.id, locationId: t.locationId, toUserIds: [o.assigneeId] });
  return {
    ok: true,
    ws: patchTicket(ws, t.id, (x) => ({
      ...x, assigneeId: o.assigneeId, status: o.status,
      declines: x.declines.map((d) => (d.id === req.id ? { ...d, state: "approved", reviewedById: actor.id, reviewedByName: actor.name, reviewedAt: iso(now), reviewComment: comment.trim() || undefined, outcome: o.outcome } : d)),
      history: withEvents(x, event(now, "decline_approved", "manager", actor.name, `Decline approved by ${actor.name}`, comment.trim()), o.ev),
    }), notes),
  };
}

/** Admin rejects the decline. A comment is mandatory; the ticket goes back to the original assignee in its previous status. */
export function rejectDecline(ws: Workspace, ticketId: string, actor: User, comment: string, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t) return fail("Ticket not found.");
  const req = pendingDecline(t);
  if (!req) return fail("There is no pending decline request on this ticket.");
  if (!canReview(ws, actor, t)) return fail("You do not have permission to review declines at this location.");
  if (comment.trim().length < 5) return fail("Add a comment for the staff member explaining why the decline was rejected (at least 5 characters).");
  return {
    ok: true,
    ws: patchTicket(ws, t.id, (x) => ({
      ...x, assigneeId: req.requestedById, status: req.previousStatus,
      declines: x.declines.map((d) => (d.id === req.id ? { ...d, state: "rejected", reviewedById: actor.id, reviewedByName: actor.name, reviewedAt: iso(now), reviewComment: comment.trim(), outcome: `Returned to ${req.requestedByName}` } : d)),
      history: withEvents(x, event(now, "decline_rejected", "manager", actor.name, `Decline rejected by ${actor.name}`, comment.trim()), event(now, "assigned", "system", "PropDesk", `Ticket returned to ${req.requestedByName} · status ${req.previousStatus}`)),
    }), [{ at: iso(now), title: `Decline rejected · ${t.id}`, body: `${actor.name}: ${comment.trim()}`, ticketId: t.id, locationId: t.locationId, toUserIds: [req.requestedById] }]),
  };
}

/** Direct reassignment (outside the decline flow). */
export function reassignTicket(ws: Workspace, ticketId: string, actor: User, target: AssignTarget, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t) return fail("Ticket not found.");
  if (!can(ws, actor, "reassign") || !canSeeTicket(ws, actor, t)) return fail("You do not have permission to reassign this ticket.");
  if (pendingDecline(t)) return fail("This ticket has a pending decline request. Approve or reject it first.");
  if (t.status === "Resolved") return fail("Resolved tickets cannot be reassigned.");
  if (target.kind === "user" && !userById(ws, target.userId)) return fail("Select a staff member from this workspace.");
  if (target.kind === "user" && target.userId === t.assigneeId) return fail("The ticket is already assigned to this person.");
  if (target.kind === "queue" && t.assigneeId === null) return fail("The ticket is already in the team queue.");
  const o = assignmentOutcome(ws, t, target, t.assigneeId, now, actor, t.status);
  const status = t.status === "Escalated" ? "Escalated" : o.status;
  return {
    ok: true,
    ws: patchTicket(ws, t.id, (x) => ({ ...x, assigneeId: o.assigneeId, status, history: withEvents(x, o.ev) }),
      o.assigneeId ? [{ at: iso(now), title: `Ticket assigned to you · ${t.id}`, body: t.title, ticketId: t.id, locationId: t.locationId, toUserIds: [o.assigneeId] }] : []),
  };
}

export function startWork(ws: Workspace, ticketId: string, actor: User, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t || t.assigneeId !== actor.id || t.status !== "Open") return fail("Only the assignee can start work on an open ticket.");
  return { ok: true, ws: patchTicket(ws, t.id, (x) => ({ ...x, status: "In Progress", history: withEvents(x, event(now, "accepted", "staff", actor.name, `${actor.name} started work`)) })) };
}

export function takeFromQueue(ws: Workspace, ticketId: string, actor: User, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t || t.assigneeId !== null || !canSeeTicket(ws, actor, t) || !isStaffRole(ws, actor)) return fail("Only staff at this location can take tickets from the team queue.");
  return { ok: true, ws: patchTicket(ws, t.id, (x) => ({ ...x, assigneeId: actor.id, status: "In Progress", history: withEvents(x, event(now, "assigned", "staff", actor.name, `${actor.name} took the ticket from the team queue`)) })) };
}

export function escalateTicket(ws: Workspace, ticketId: string, actor: User, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t || !canSeeTicket(ws, actor, t)) return fail("Ticket not found.");
  if (t.status === "Escalated" || t.status === "Resolved" || t.status === "Pending Admin Review") return fail(`A ticket that is ${t.status.toLowerCase()} cannot be escalated.`);
  return { ok: true, ws: patchTicket(ws, t.id, (x) => ({ ...x, status: "Escalated", history: withEvents(x, event(now, "escalated", sourceFor(ws, actor), actor.name, `Escalated manually by ${actor.name}`)) })) };
}

export function resolveTicket(ws: Workspace, ticketId: string, actor: User, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t || !canSeeTicket(ws, actor, t)) return fail("Ticket not found.");
  if (!can(ws, actor, "edit") && t.assigneeId !== actor.id) return fail("You do not have permission to resolve this ticket.");
  if (t.status === "Pending Admin Review") return fail("A ticket awaiting decline review cannot be resolved.");
  if (t.status === "Resolved") return fail("Ticket is already resolved.");
  return { ok: true, ws: patchTicket(ws, t.id, (x) => ({ ...x, status: "Resolved", resolvedAt: iso(now), history: withEvents(x, event(now, "resolved", sourceFor(ws, actor), actor.name, `Resolved by ${actor.name}`)) })) };
}

export function addNote(ws: Workspace, ticketId: string, actor: User, text: string, now: number): Result {
  const t = ws.tickets.find((x) => x.id === ticketId);
  if (!t || !canSeeTicket(ws, actor, t)) return fail("Ticket not found.");
  if (!text.trim()) return fail("Write a note first.");
  return { ok: true, ws: patchTicket(ws, t.id, (x) => ({ ...x, history: withEvents(x, event(now, "note", sourceFor(ws, actor), actor.name, "Internal note added", text.trim())) })) };
}

export type NewTicket = {
  title: string; description: string; tenant: string; contact: string; channel: string; locationId: string; unit: string;
  categoryId: string; priority: Priority; sentiment: Sentiment; tags: string[]; target: AssignTarget;
};

export function createTicket(ws: Workspace, actor: User, input: NewTicket, now: number): Result {
  if (!can(ws, actor, "create")) return fail("You do not have permission to create tickets.");
  if (!input.tenant.trim() || !input.title.trim() || !input.unit.trim()) return fail("Resident, unit and issue title are required.");
  if (!accessibleLocationIds(ws, actor).includes(input.locationId)) return fail("Choose a location you have access to.");
  if (!ws.categories.some((c) => c.id === input.categoryId)) return fail("Choose a category.");
  const id = `${ws.customer.ticketPrefix}-${ws.customer.nextTicketNo}`;
  const assignee = input.target.kind === "user" ? userById(ws, input.target.userId) : undefined;
  const history = [
    assignee ? event(now, "assigned", "system", "Routing engine", `Assigned to ${assignee.name}`) : event(now, "queued", "system", "Routing engine", "Placed in team queue"),
    event(now, "ai", "ai", "PropDesk AI", "Category and sentiment analysis completed (simulated)", `${input.sentiment} sentiment`),
    event(now, "created", "crm", actor.name, `Ticket created from ${input.channel.toLowerCase()}`),
  ];
  const t: Ticket = {
    id, title: input.title.trim(), description: input.description.trim(), tenant: input.tenant.trim(), contact: input.contact.trim(), channel: input.channel,
    locationId: input.locationId, unit: input.unit.trim(), categoryId: input.categoryId, priority: input.priority, sentiment: input.sentiment, tags: input.tags,
    assigneeId: assignee?.id ?? null, status: "Open", createdAt: iso(now), declines: [], history,
  };
  const notes: Notification[] = assignee ? [{ id: uid("n"), at: iso(now), title: `New ticket assigned · ${id}`, body: t.title, ticketId: id, locationId: t.locationId, toUserIds: [assignee.id], readBy: [] }] : [];
  return { ok: true, ticketId: id, ws: { ...ws, customer: { ...ws.customer, nextTicketNo: ws.customer.nextTicketNo + 1 }, tickets: [t, ...ws.tickets], notifications: [...notes, ...ws.notifications] } };
}

/* ------------------------------------------------------------------ */
/* Notifications (simulated in-app delivery)                           */
/* ------------------------------------------------------------------ */
export function notificationsFor(ws: Workspace, u: User | undefined): Notification[] {
  if (!u) return [];
  const locs = accessibleLocationIds(ws, u);
  return ws.notifications
    .filter((n) => n.toUserIds?.includes(u.id) || (n.toPerm && can(ws, u, n.toPerm) && locs.includes(n.locationId)))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export const markRead = (ws: Workspace, u: User, ids: string[]): Workspace =>
  ({ ...ws, notifications: ws.notifications.map((n) => (ids.includes(n.id) && !n.readBy.includes(u.id) ? { ...n, readBy: [...n.readBy, u.id] } : n)) });
