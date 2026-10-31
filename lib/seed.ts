import { PERMS, type Category, type DeclineReason, type Registry, type EventSource, type EventType, type Level, type Location, type Persona, type PermMatrix, type Priority, type Role, type RoutingRule, type Sentiment, type Ticket, type TicketEvent, type TicketStatus, type User, type Workspace } from "./model.ts";

/* Sample data for the prototype. Times are generated relative to "now" so
   SLA timers look realistic right after a reset. */

export const DEMO_VERSION = 3;

/** Prototype stand-in for "one database per customer": each customer gets its own storage key. */
export const dbKey = (customerId: string) => `propdesk.db.${customerId}`;

/** Builds a permission row in PERMS column order. */
export const P = (...flags: boolean[]): Record<string, boolean> => Object.fromEntries(PERMS.map(([k], i) => [k, !!flags[i]]));

export const defaultChain = (): Level[] => [
  { id: "l1", to: ["t2"], mode: "sequential", ackMins: 30 },
  { id: "l2", to: ["t1", "regional"], mode: "parallel", ackMins: 15 },
  { id: "l3", to: ["super"], mode: "sequential", ackMins: 10 },
];

const chainsFor = (cats: Category[], overrides: Record<string, Level[]> = {}) =>
  Object.fromEntries(cats.map((c) => [c.id, overrides[c.id] ?? defaultChain()]));

const defaultMultipliers = (): Record<Priority, number> => ({ Urgent: 0.25, High: 0.5, Normal: 1, Low: 2 });

/* ------------------------------------------------------------------ */
/* Ticket builder                                                      */
/* ------------------------------------------------------------------ */
type DeclineSeed = { by: string; reasonId: string; explanation: string; agoMins: number; previousStatus: TicketStatus; reviewer?: string; comment?: string };
type TicketSeed = {
  no: number; title: string; description: string; tenant: string; contact: string; channel?: string;
  locationId: string; unit: string; categoryId: string; priority: Priority; sentiment: Sentiment; tags: string[];
  assigneeId: string | null; status: TicketStatus; agoMins: number; resolvedAgoMins?: number; decline?: DeclineSeed;
};

function buildTickets(prefix: string, users: User[], reasons: DeclineReason[], seeds: TicketSeed[], now: number): Ticket[] {
  const at = (ago: number) => new Date(now - ago * 60000).toISOString();
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? "Unassigned";
  return seeds.map((s) => {
    const id = `${prefix}-${s.no}`;
    let n = 0;
    const history: TicketEvent[] = [];
    const ev = (ago: number, type: EventType, source: EventSource, actorName: string, text: string, detail?: string) =>
      history.push({ id: `${id}-e${n++}`, at: at(ago), type, source, actorName, text, detail });

    ev(s.agoMins, "created", "crm", "Helpdesk", `Ticket created from ${(s.channel ?? "Inbound call").toLowerCase()}`);
    ev(s.agoMins - 2, "ai", "ai", "PropDesk AI", "Category and sentiment analysis completed", `${s.sentiment} sentiment`);
    const routedTo = s.decline ? s.decline.by : s.assigneeId;
    if (routedTo) ev(s.agoMins - 3, "assigned", "system", "Routing engine", `Auto-routed to ${name(routedTo)}`);
    else ev(s.agoMins - 3, "queued", "system", "Routing engine", "Placed in team queue", "No eligible staff available at routing time");
    const workedStatus = s.decline && !s.decline.reviewer ? s.decline.previousStatus : s.status;
    if (routedTo && workedStatus !== "Open") ev(s.agoMins - 8, "accepted", "staff", name(routedTo), `${name(routedTo)} accepted assignment`);
    if (s.status === "Escalated") ev(Math.max(1, s.agoMins - 60), "escalated", "system", "SLA monitor", "SLA at risk — escalated to Level 1");

    const declines: Ticket["declines"] = [];
    if (s.decline) {
      const d = s.decline;
      const reason = reasons.find((r) => r.id === d.reasonId)!;
      ev(d.agoMins, "decline_requested", "staff", name(d.by), `${name(d.by)} requested to decline this ticket`);
      ev(d.agoMins, "decline_reason", "staff", name(d.by), `Decline reason submitted: ${reason.label}`, d.explanation || undefined);
      const req = { id: `${id}-d1`, reasonId: reason.id, reasonLabel: reason.label, explanation: d.explanation, requestedById: d.by, requestedByName: name(d.by), requestedAt: at(d.agoMins), previousStatus: d.previousStatus };
      if (d.reviewer) {
        ev(d.agoMins - 10, "decline_rejected", "manager", name(d.reviewer), `Decline rejected by ${name(d.reviewer)}`, d.comment);
        declines.push({ ...req, state: "rejected", reviewedById: d.reviewer, reviewedByName: name(d.reviewer), reviewedAt: at(d.agoMins - 10), reviewComment: d.comment, outcome: `Returned to ${name(d.by)}` });
      } else declines.push({ ...req, state: "pending" });
    }
    if (s.status === "Resolved" && s.resolvedAgoMins != null) ev(s.resolvedAgoMins, "resolved", "staff", name(s.assigneeId), "Ticket resolved");

    return {
      id, title: s.title, description: s.description, tenant: s.tenant, contact: s.contact, channel: s.channel ?? "Inbound call",
      locationId: s.locationId, unit: s.unit, categoryId: s.categoryId, priority: s.priority, sentiment: s.sentiment, tags: s.tags,
      assigneeId: s.assigneeId, status: s.status, createdAt: at(s.agoMins), resolvedAt: s.resolvedAgoMins != null ? at(s.resolvedAgoMins) : undefined,
      declines, history: history.sort((a, b) => b.at.localeCompare(a.at)),
    };
  });
}

const reasonSet = (extra: DeclineReason[] = []): DeclineReason[] => [
  { id: "skill", label: "Insufficient technical knowledge or skill", requiresExplanation: false, active: true },
  { id: "scope", label: "Outside assigned responsibilities", requiresExplanation: false, active: true },
  { id: "busy", label: "Currently handling other critical tickets", requiresExplanation: false, active: true },
  { id: "unavailable", label: "Unavailable during the required service period", requiresExplanation: false, active: true },
  { id: "category", label: "Incorrect ticket category", requiresExplanation: false, active: true },
  { id: "info", label: "Missing information from tenant", requiresExplanation: false, active: true },
  ...extra,
  { id: "other", label: "Other", requiresExplanation: true, active: true },
];

/* ------------------------------------------------------------------ */
/* Customer A: Prestige Group                                          */
/* ------------------------------------------------------------------ */
function prestige(now: number): Workspace {
  const locations: Location[] = [
    { id: "pr-lakeside", name: "Prestige Lakeside Habitat", code: "PLH", city: "Bengaluru", address: "Varthur Main Road, Whitefield", units: 3426, occupied: 3105, blocks: "21 towers", officeHours: "08:00–20:00 daily", emergencyContact: "+91 80 4000 1100", status: "Active", avgResolveHrs: 7.2 },
    { id: "pr-falcon", name: "Prestige Falcon City", code: "PFC", city: "Bengaluru", address: "Kanakapura Road, Konanakunte", units: 2556, occupied: 2310, blocks: "13 towers", officeHours: "08:00–20:00 daily", emergencyContact: "+91 80 4000 2200", status: "Active", avgResolveHrs: 8.9 },
    { id: "pr-shanti", name: "Prestige Shantiniketan", code: "PSN", city: "Bengaluru", address: "ITPL Main Road, Whitefield", units: 3000, occupied: 2780, blocks: "Blocks A–L", officeHours: "09:00–19:00, Mon–Sat", emergencyContact: "+91 80 4000 3300", status: "Active", avgResolveHrs: 6.1 },
  ];
  const roles: Role[] = [
    { id: "super", name: "Customer Super Admin", desc: "One per customer. Configures roles, locations, categories, SLAs and licensing. Sees every location.", kind: "system", locked: true, scope: "all" },
    { id: "regional", name: "Regional Admin", desc: "Delegated admin for selected locations. Reviews decline requests and manages locations.", kind: "system", scope: "assigned" },
    { id: "t1", name: "Site Manager", desc: "Type 1 tier, renamed for Prestige. Runs assigned sites and reviews staff declines.", kind: "tier", scope: "assigned" },
    { id: "t2", name: "Senior Technician", desc: "Type 2 tier. First escalation point for technicians.", kind: "tier", scope: "assigned" },
    { id: "t3", name: "Technician", desc: "Type 3 tier. Front-line staff working assigned tickets.", kind: "tier", scope: "assigned" },
  ];
  //                       view create edit  del   reasgn decline review locs  config users billing
  const perms: PermMatrix = {
    super:    P(true, true, true, true, true, false, true, true, true, true, true),
    regional: P(true, true, true, true, true, false, true, true, true, true, false),
    t1:       P(true, true, true, false, true, true, true, false, false, false, false),
    t2:       P(true, true, true, false, false, true, false, false, false, false, false),
    t3:       P(true, true, false, false, false, true, false, false, false, false, false),
  };
  const all = locations.map((l) => l.id);
  const users: User[] = [
    { id: "pr-u1", name: "Vikram Shetty", email: "vikram.shetty@prestige.example", roleId: "super", skills: [], availability: "Available", open: 0, locationIds: all, team: "Head office" },
    { id: "pr-u2", name: "Kavya Rao", email: "kavya.rao@zongovita.example", roleId: "regional", skills: [], availability: "Available", open: 0, locationIds: all, team: "Zongovita operations" },
    { id: "pr-u3", name: "Rohan Mehta", email: "rohan.mehta@prestige.example", roleId: "regional", skills: [], availability: "Available", open: 0, locationIds: ["pr-lakeside", "pr-shanti"], team: "Whitefield region" },
    { id: "pr-u4", name: "Sneha Kulkarni", email: "sneha.kulkarni@prestige.example", roleId: "t1", skills: [], availability: "Available", open: 0, locationIds: ["pr-falcon"], team: "Site management" },
    { id: "pr-u5", name: "Farhan Sheikh", email: "farhan.sheikh@prestige.example", roleId: "t1", skills: [], availability: "On call", open: 0, locationIds: ["pr-lakeside"], team: "Site management" },
    { id: "pr-u6", name: "Arjun Nair", email: "arjun.nair@prestige.example", roleId: "t3", skills: ["Plumbing", "Electrical"], availability: "Available", open: 0, locationIds: ["pr-lakeside"], team: "Maintenance" },
    { id: "pr-u7", name: "Lakshmi Menon", email: "lakshmi.menon@prestige.example", roleId: "t2", skills: ["Electrical", "Lift", "Power backup"], availability: "On call", open: 0, locationIds: ["pr-lakeside", "pr-shanti"], team: "Maintenance" },
    { id: "pr-u8", name: "Suresh Gowda", email: "suresh.gowda@prestige.example", roleId: "t3", skills: ["Plumbing", "Carpentry"], availability: "Available", open: 0, locationIds: ["pr-falcon"], team: "Maintenance" },
    { id: "pr-u9", name: "Deepa Joseph", email: "deepa.joseph@prestige.example", roleId: "t3", skills: ["Housekeeping", "Pest control", "Carpentry"], availability: "Available", open: 0, locationIds: ["pr-shanti", "pr-falcon"], team: "Facilities" },
    { id: "pr-u10", name: "Manoj Kumar", email: "manoj.kumar@prestige.example", roleId: "t3", skills: ["Security & access"], availability: "Unavailable", open: 0, locationIds: ["pr-lakeside"], team: "Security" },
    { id: "pr-u11", name: "Imran Pasha", email: "imran.pasha@prestige.example", roleId: "t2", skills: ["Plumbing", "Electrical", "Lift"], availability: "Available", open: 0, locationIds: ["pr-falcon"], team: "Maintenance" },
    { id: "pr-u12", name: "Ravi Teja", email: "ravi.teja@prestige.example", roleId: "t3", skills: ["Lift", "Power backup", "Electrical"], availability: "Available", open: 0, locationIds: ["pr-shanti", "pr-lakeside"], team: "Maintenance" },
  ];
  const categories: Category[] = [
    { id: "plumbing", name: "Plumbing", responseMins: 120, resolveMins: 720 },
    { id: "electrical", name: "Electrical", responseMins: 60, resolveMins: 480 },
    { id: "lift", name: "Lift", responseMins: 15, resolveMins: 240 },
    { id: "power", name: "Power backup", responseMins: 30, resolveMins: 240 },
    { id: "security", name: "Security & access", responseMins: 15, resolveMins: 120 },
    { id: "housekeeping", name: "Housekeeping", responseMins: 240, resolveMins: 1440 },
    { id: "pest", name: "Pest control", responseMins: 480, resolveMins: 2880 },
    { id: "carpentry", name: "Carpentry", responseMins: 240, resolveMins: 1440 },
    { id: "amenities", name: "Clubhouse & amenities", responseMins: 240, resolveMins: 2880 },
  ];
  const declineReasons = reasonSet();
  const tickets = buildTickets("PRS", users, declineReasons, [
    { no: 1048, title: "Lift stuck between floors — Tower 4", description: "Resident reports Lift B in Tower 4 stopped between floors 7 and 8 with nobody inside. The other lift has a long queue in the morning rush. Security has put a notice on every floor.", tenant: "Ananya Krishnan", contact: "+91 98450 11223", locationId: "pr-lakeside", unit: "T4-1203", categoryId: "lift", priority: "Urgent", sentiment: "Negative", tags: ["Lift out of service", "Elderly residents"], assigneeId: "pr-u6", status: "Pending Admin Review", agoMins: 25,
      decline: { by: "pr-u6", reasonId: "skill", explanation: "Needs a certified lift technician. I handle plumbing and electrical only and can't safely open the lift controller.", agoMins: 12, previousStatus: "In Progress" } },
    { no: 1047, title: "Low water pressure in master bathroom", description: "Very low pressure from the shower and wash basin in the master bathroom since this morning. The kitchen is fine.", tenant: "Rahul Verma", contact: "+91 99000 45678", channel: "Resident app", locationId: "pr-lakeside", unit: "T2-0804", categoryId: "plumbing", priority: "High", sentiment: "Neutral", tags: ["Bathroom"], assigneeId: "pr-u6", status: "In Progress", agoMins: 140 },
    { no: 1046, title: "Kitchen sink drain blocked", description: "Kitchen sink drain is blocked and water is backing up. Resident has tried a plunger. Requests a visit before the weekend.", tenant: "Meenakshi Sundaram", contact: "+91 97411 90876", locationId: "pr-falcon", unit: "T9-1502", categoryId: "plumbing", priority: "Normal", sentiment: "Negative", tags: ["Kitchen", "Repeat issue"], assigneeId: "pr-u8", status: "Pending Admin Review", agoMins: 200,
      decline: { by: "pr-u8", reasonId: "busy", explanation: "Handling the overflowing sump at Tower 3 and can't attend before tomorrow.", agoMins: 95, previousStatus: "Open" } },
    { no: 1045, title: "DG backup not kicking in during power cuts", description: "During the last two power cuts the DG backup did not switch on for Block C flats. Resident works from home and lost power for 40 minutes.", tenant: "Kiran Rao", contact: "+91 98860 33445", channel: "Email", locationId: "pr-shanti", unit: "C-702", categoryId: "power", priority: "High", sentiment: "Negative", tags: ["Work from home", "Block-wide"], assigneeId: "pr-u7", status: "Escalated", agoMins: 135 },
    { no: 1044, title: "Cockroach infestation in utility area", description: "Resident is requesting pest control treatment for the utility area and kitchen. Neighbours report the same.", tenant: "Fatima Begum", contact: "+91 90080 12121", channel: "Resident app", locationId: "pr-falcon", unit: "T5-0303", categoryId: "pest", priority: "Low", sentiment: "Neutral", tags: ["Neighbours affected"], assigneeId: null, status: "Open", agoMins: 300 },
    { no: 1043, title: "Common corridor not cleaned for two days", description: "The 11th floor corridor in Block A has not been mopped for two days and the garbage chute area smells.", tenant: "Siddharth Jain", contact: "+91 99860 77889", channel: "Resident app", locationId: "pr-shanti", unit: "A-1101", categoryId: "housekeeping", priority: "Normal", sentiment: "Positive", tags: ["Common area"], assigneeId: "pr-u9", status: "In Progress", agoMins: 400 },
    { no: 1042, title: "Boom barrier at Gate 2 not opening for residents", description: "Resident RFID tags are not being read at Gate 2. Guards are opening the barrier manually and queues are building at peak time.", tenant: "Pooja Shenoy", contact: "+91 98440 56565", locationId: "pr-lakeside", unit: "T1-0201", categoryId: "security", priority: "High", sentiment: "Negative", tags: ["Gate 2", "Peak hours"], assigneeId: "pr-u10", status: "Open", agoMins: 45 },
    { no: 1041, title: "Sparking from switchboard in living room", description: "Resident saw sparks from the living room switchboard when switching on the AC. The MCB has been switched off as a precaution.", tenant: "Varun Desai", contact: "+91 97390 24680", locationId: "pr-falcon", unit: "T7-1801", categoryId: "electrical", priority: "Urgent", sentiment: "Negative", tags: ["Safety risk", "MCB off"], assigneeId: "pr-u11", status: "In Progress", agoMins: 70,
      decline: { by: "pr-u11", reasonId: "unavailable", explanation: "My shift ends at 4 pm today.", agoMins: 55, previousStatus: "In Progress", reviewer: "pr-u4", comment: "Shift swap with Suresh approved. Please attend before 6 pm. This is a safety issue." } },
    { no: 1040, title: "Wardrobe door hinge broken", description: "Bedroom wardrobe door hinge came off. The door needs re-hanging.", tenant: "Nisha Pillai", contact: "+91 99450 13579", channel: "Resident app", locationId: "pr-shanti", unit: "B-404", categoryId: "carpentry", priority: "Low", sentiment: "Positive", tags: [], assigneeId: "pr-u9", status: "Resolved", agoMins: 1500, resolvedAgoMins: 900 },
  ], now);
  const routingRules: RoutingRule[] = [
    { id: "r1", locationId: "pr-lakeside", categoryId: "lift", primaryId: "pr-u7", backupId: "pr-u12", managerId: "pr-u5" },
    { id: "r2", locationId: "pr-falcon", categoryId: "plumbing", primaryId: "pr-u8", backupId: "pr-u11", managerId: "pr-u4" },
    { id: "r3", locationId: "pr-shanti", categoryId: "power", primaryId: "pr-u7", backupId: "pr-u12", managerId: "pr-u3" },
    { id: "r4", locationId: "all", categoryId: "security", primaryId: "pr-u10", backupId: "pr-u5", managerId: "pr-u3" },
  ];
  return {
    customer: { id: "prestige", name: "Prestige Group", short: "PG", region: "Bengaluru, India", ticketPrefix: "PRS", nextTicketNo: 1049 },
    locations, roles, perms, users, categories,
    chains: chainsFor(categories, { security: [{ id: "l1", to: ["t1"], mode: "sequential", ackMins: 10 }, { id: "l2", to: ["regional", "super"], mode: "parallel", ackMins: 5 }] }),
    multipliers: defaultMultipliers(),
    declineReasons, routingRules, tickets,
    notifications: tickets.flatMap((t) => t.declines.filter((d) => d.state === "pending").map((d) => ({
      id: `${d.id}-n`, at: d.requestedAt, title: `Decline request · ${t.id}`, body: `${d.requestedByName}: ${d.reasonLabel}`, ticketId: t.id, locationId: t.locationId, toPerm: "review" as const, readBy: [],
    }))),
    trend: { created: [22, 28, 35, 30, 41, 38, 44], resolved: [20, 25, 27, 33, 35, 40, 39] },
  };
}

/* ------------------------------------------------------------------ */
/* Customer B: Harbourline Property Management (original sample data)   */
/* ------------------------------------------------------------------ */
function harbourline(now: number): Workspace {
  const locations: Location[] = [
    { id: "hl-foundry", name: "The Foundry", code: "FDY", city: "Manchester", address: "12 Jersey Street, Ancoats", units: 186, occupied: 179, blocks: "2 blocks", officeHours: "08:00–18:00, Mon–Fri", emergencyContact: "+44 161 555 0100", status: "Active", avgResolveHrs: 9.4 },
    { id: "hl-harbour", name: "Harbour Court", code: "HBC", city: "Liverpool", address: "4 Mann Island", units: 142, occupied: 131, blocks: "1 tower", officeHours: "08:00–18:00, Mon–Sat", emergencyContact: "+44 151 555 0200", status: "Active", avgResolveHrs: 6.2 },
    { id: "hl-arcadia", name: "Arcadia House", code: "ARC", city: "Leeds", address: "88 Wellington Street", units: 96, occupied: 94, blocks: "1 block", officeHours: "09:00–17:00, Mon–Fri", emergencyContact: "+44 113 555 0300", status: "Active", avgResolveHrs: 4.8 },
    { id: "hl-quayside", name: "Quayside Place", code: "QSP", city: "Newcastle", address: "21 Quayside", units: 120, occupied: 103, blocks: "3 blocks", officeHours: "08:00–18:00, Mon–Fri", emergencyContact: "+44 191 555 0400", status: "Active", avgResolveHrs: 4.1 },
  ];
  const roles: Role[] = [
    { id: "super", name: "Super Admin", desc: "One per enterprise. Configures roles, tiers, categories, SLAs and licensing.", kind: "system", locked: true, scope: "all" },
    { id: "regional", name: "Regional Admin", desc: "Delegated admin for a region or property group. Cannot change licensing.", kind: "system", scope: "assigned" },
    { id: "t1", name: "Type 1", desc: "Senior tier. Final escalation point before admins.", kind: "tier", scope: "assigned" },
    { id: "t2", name: "Type 2", desc: "Middle tier. First escalation point for assignees.", kind: "tier", scope: "assigned" },
    { id: "t3", name: "Type 3", desc: "Front-line tier. Works assigned tickets.", kind: "tier", scope: "assigned" },
  ];
  //                       view create edit  del   reasgn decline review locs  config users billing
  const perms: PermMatrix = {
    super:    P(true, true, true, true, true, false, true, true, true, true, true),
    regional: P(true, true, true, true, true, false, true, true, true, true, false),
    t1:       P(true, true, true, false, true, true, false, false, false, false, false),
    t2:       P(true, true, true, false, true, true, false, false, false, false, false),
    t3:       P(true, true, false, false, false, true, false, false, false, false, false),
  };
  const all = locations.map((l) => l.id);
  const users: User[] = [
    { id: "hl-u1", name: "Olivia Price", email: "olivia.price@example.com", roleId: "super", skills: [], availability: "Available", open: 0, locationIds: all, team: "Operations" },
    { id: "hl-u2", name: "Hannah Reid", email: "hannah.reid@example.com", roleId: "regional", skills: [], availability: "Available", open: 0, locationIds: ["hl-harbour", "hl-quayside"], team: "North West" },
    { id: "hl-u3", name: "Ruth Allen", email: "ruth.allen@example.com", roleId: "t1", skills: [], availability: "Available", open: 0, locationIds: ["hl-foundry", "hl-harbour"], team: "Operations" },
    { id: "hl-u4", name: "James Cole", email: "james.cole@example.com", roleId: "t1", skills: [], availability: "On call", open: 0, locationIds: ["hl-arcadia", "hl-quayside"], team: "Operations" },
    { id: "hl-u5", name: "Priya Shah", email: "priya.shah@example.com", roleId: "t2", skills: ["Access", "Noise", "Safeguarding"], availability: "On call", open: 0, locationIds: all, team: "Resident services" },
    { id: "hl-u6", name: "Dana Hughes", email: "dana.hughes@example.com", roleId: "t3", skills: ["Heating", "Plumbing", "Electrical"], availability: "Available", open: 0, locationIds: ["hl-foundry", "hl-arcadia"], team: "Maintenance" },
    { id: "hl-u7", name: "Marcus Lee", email: "marcus.lee@example.com", roleId: "t3", skills: ["Heating", "Electrical", "Access", "Lift"], availability: "Available", open: 0, locationIds: ["hl-harbour", "hl-foundry", "hl-quayside"], team: "Maintenance" },
    { id: "hl-u8", name: "Alex Morgan", email: "alex.morgan@example.com", roleId: "t3", skills: ["Noise", "Safeguarding"], availability: "Unavailable", open: 0, locationIds: ["hl-quayside"], team: "Compliance" },
    { id: "hl-u9", name: "Kavya Rao", email: "kavya.rao@zongovita.example", roleId: "regional", skills: [], availability: "Available", open: 0, locationIds: ["hl-foundry", "hl-harbour", "hl-arcadia"], team: "Zongovita operations" },
  ];
  const categories: Category[] = [
    { id: "heating", name: "Heating", responseMins: 60, resolveMins: 480 },
    { id: "plumbing", name: "Plumbing", responseMins: 120, resolveMins: 720 },
    { id: "electrical", name: "Electrical", responseMins: 60, resolveMins: 480 },
    { id: "access", name: "Access", responseMins: 30, resolveMins: 240 },
    { id: "lift", name: "Lift", responseMins: 30, resolveMins: 360 },
    { id: "noise", name: "Noise", responseMins: 240, resolveMins: 1440 },
    { id: "safeguarding", name: "Safeguarding", responseMins: 15, resolveMins: 120 },
  ];
  const declineReasons = reasonSet([{ id: "gas", label: "Requires a Gas Safe registered engineer", requiresExplanation: false, active: true }]);
  const tickets = buildTickets("HD", users, declineReasons, [
    { no: 24891, title: "No heating — boiler failure", description: "Tenant reports the boiler stopped working overnight. The flat is currently 14°C and there is a young child in the property. Restart procedure was attempted without success.", tenant: "Maya Patel", contact: "+44 7700 900421", locationId: "hl-foundry", unit: "4B", categoryId: "heating", priority: "Urgent", sentiment: "Negative", tags: ["No heating", "Child present", "14°C"], assigneeId: "hl-u6", status: "In Progress", agoMins: 78 },
    { no: 24890, title: "Fob not opening main entrance", description: "Tenant's key fob stopped opening the main entrance door. They were let in by a neighbour.", tenant: "Leon Brooks", contact: "+44 7700 900188", locationId: "hl-harbour", unit: "12A", categoryId: "access", priority: "High", sentiment: "Negative", tags: ["Locked out risk"], assigneeId: "hl-u7", status: "Open", agoMins: 40 },
    { no: 24887, title: "Leak under kitchen sink", description: "Slow leak from the trap under the kitchen sink. The cupboard base is swelling. Tenant has put a bowl underneath.", tenant: "Sofia Almeida", contact: "+44 7700 900634", channel: "Email", locationId: "hl-arcadia", unit: "7C", categoryId: "plumbing", priority: "Normal", sentiment: "Neutral", tags: ["Kitchen"], assigneeId: "hl-u5", status: "Pending Admin Review", agoMins: 180,
      decline: { by: "hl-u5", reasonId: "category", explanation: "This was routed to resident services but it needs a plumber.", agoMins: 60, previousStatus: "In Progress" } },
    { no: 24884, title: "Bathroom lights tripping the fuse box", description: "Bathroom lights trip the RCD every time they are switched on.", tenant: "Noah Williams", contact: "+44 7700 900902", locationId: "hl-foundry", unit: "2F", categoryId: "electrical", priority: "High", sentiment: "Positive", tags: ["RCD trip"], assigneeId: "hl-u6", status: "Escalated", agoMins: 256 },
    { no: 24880, title: "Ongoing noise from flat above", description: "Repeated late-night noise from the flat above (18E) over the past week.", tenant: "Amelia Chen", contact: "+44 7700 900311", channel: "Tenant portal", locationId: "hl-quayside", unit: "18D", categoryId: "noise", priority: "Normal", sentiment: "Neutral", tags: ["Neighbour dispute"], assigneeId: null, status: "Open", agoMins: 120 },
    { no: 24876, title: "Lift out of service — Harbour Court", description: "Main lift is showing an error code and won't go above level 3.", tenant: "Oliver Grant", contact: "+44 7700 900550", locationId: "hl-harbour", unit: "9E", categoryId: "lift", priority: "High", sentiment: "Negative", tags: ["Mobility needs"], assigneeId: "hl-u7", status: "In Progress", agoMins: 158 },
    { no: 24872, title: "Water ingress from balcony above", description: "Water is coming through the ceiling by the balcony door after rain. Likely failed sealant on the balcony above.", tenant: "Grace Okafor", contact: "+44 7700 900777", locationId: "hl-arcadia", unit: "11B", categoryId: "plumbing", priority: "High", sentiment: "Neutral", tags: ["Ceiling damage"], assigneeId: "hl-u6", status: "In Progress", agoMins: 90,
      decline: { by: "hl-u6", reasonId: "busy", explanation: "Still on the boiler failure at The Foundry.", agoMins: 70, previousStatus: "In Progress", reviewer: "hl-u1", comment: "Marcus is covering The Foundry this afternoon. Please attend Arcadia first." } },
    { no: 24869, title: "Hallway socket not working", description: "Double socket in the hallway has stopped working.", tenant: "Ethan Clarke", contact: "+44 7700 900244", channel: "Tenant portal", locationId: "hl-harbour", unit: "5C", categoryId: "electrical", priority: "Normal", sentiment: "Positive", tags: [], assigneeId: "hl-u7", status: "Resolved", agoMins: 600, resolvedAgoMins: 300 },
  ], now);
  const routingRules: RoutingRule[] = [
    { id: "r1", locationId: "hl-foundry", categoryId: "heating", primaryId: "hl-u6", backupId: "hl-u7", managerId: "hl-u3" },
    { id: "r2", locationId: "hl-harbour", categoryId: "access", primaryId: "hl-u7", backupId: "hl-u5", managerId: "hl-u3" },
    { id: "r3", locationId: "all", categoryId: "safeguarding", primaryId: "hl-u5", backupId: "hl-u6", managerId: "hl-u4" },
    { id: "r4", locationId: "hl-arcadia", categoryId: "plumbing", primaryId: "hl-u6", backupId: "hl-u7", managerId: "hl-u4" },
  ];
  return {
    customer: { id: "harbourline", name: "Harbourline Property Management", short: "HP", region: "United Kingdom", ticketPrefix: "HD", nextTicketNo: 24892 },
    locations, roles, perms, users, categories,
    chains: chainsFor(categories, { safeguarding: [{ id: "l1", to: ["t2", "t1"], mode: "parallel", ackMins: 10 }, { id: "l2", to: ["regional", "super"], mode: "parallel", ackMins: 5 }] }),
    multipliers: defaultMultipliers(),
    declineReasons, routingRules, tickets,
    notifications: tickets.flatMap((t) => t.declines.filter((d) => d.state === "pending").map((d) => ({
      id: `${d.id}-n`, at: d.requestedAt, title: `Decline request · ${t.id}`, body: `${d.requestedByName}: ${d.reasonLabel}`, ticketId: t.id, locationId: t.locationId, toPerm: "review" as const, readBy: [],
    }))),
    trend: { created: [18, 31, 25, 46, 36, 51, 42], resolved: [12, 21, 30, 24, 38, 32, 46] },
  };
}

/* ------------------------------------------------------------------ */
/* Customer C: Skyline Habitat Services (licence EXPIRED in the demo)   */
/* ------------------------------------------------------------------ */
function skyline(now: number): Workspace {
  const locations: Location[] = [
    { id: "sk-baner", name: "Skyline Baner Heights", code: "SBH", city: "Pune", address: "Baner–Pashan Link Road", units: 640, occupied: 590, blocks: "4 towers", officeHours: "09:00–19:00 daily", emergencyContact: "+91 20 4000 1100", status: "Active", avgResolveHrs: 7.8 },
    { id: "sk-kharadi", name: "Skyline Kharadi Greens", code: "SKG", city: "Pune", address: "EON IT Park Road, Kharadi", units: 480, occupied: 455, blocks: "3 towers", officeHours: "09:00–19:00 daily", emergencyContact: "+91 20 4000 2200", status: "Active", avgResolveHrs: 6.5 },
  ];
  const roles: Role[] = [
    { id: "super", name: "Super Admin", desc: "One per customer. Configures everything for Skyline.", kind: "system", locked: true, scope: "all" },
    { id: "regional", name: "Regional Admin", desc: "Delegated admin for selected sites.", kind: "system", scope: "assigned" },
    { id: "t1", name: "Type 1", desc: "Senior tier.", kind: "tier", scope: "assigned" },
    { id: "t2", name: "Type 2", desc: "Middle tier.", kind: "tier", scope: "assigned" },
    { id: "t3", name: "Type 3", desc: "Front-line tier.", kind: "tier", scope: "assigned" },
  ];
  const perms: PermMatrix = {
    super:    P(true, true, true, true, true, false, true, true, true, true, true),
    regional: P(true, true, true, true, true, false, true, true, true, true, false),
    t1:       P(true, true, true, false, true, true, true, false, false, false, false),
    t2:       P(true, true, true, false, false, true, false, false, false, false, false),
    t3:       P(true, true, false, false, false, true, false, false, false, false, false),
  };
  const all = locations.map((l) => l.id);
  const users: User[] = [
    { id: "sk-u1", name: "Neha Joshi", email: "neha.joshi@skyline.example", roleId: "super", skills: [], availability: "Available", open: 0, locationIds: all, team: "Head office" },
    { id: "sk-u2", name: "Kavya Rao", email: "kavya.rao@zongovita.example", roleId: "regional", skills: [], availability: "Available", open: 0, locationIds: all, team: "Zongovita operations" },
    { id: "sk-u3", name: "Amit Patil", email: "amit.patil@skyline.example", roleId: "t3", skills: ["Plumbing", "Electrical"], availability: "Available", open: 0, locationIds: all, team: "Maintenance" },
  ];
  const categories: Category[] = [
    { id: "plumbing", name: "Plumbing", responseMins: 120, resolveMins: 720 },
    { id: "electrical", name: "Electrical", responseMins: 60, resolveMins: 480 },
  ];
  const declineReasons = reasonSet();
  const tickets = buildTickets("SKY", users, declineReasons, [
    { no: 310, title: "Bathroom tap leaking", description: "Continuous drip from the bathroom tap.", tenant: "Rajesh Kulkarni", contact: "+91 98220 11111", locationId: "sk-baner", unit: "B2-0905", categoryId: "plumbing", priority: "Normal", sentiment: "Neutral", tags: [], assigneeId: "sk-u3", status: "Open", agoMins: 90 },
    { no: 309, title: "Corridor lights off on floor 6", description: "All corridor lights on floor 6 are off.", tenant: "Swati Deshpande", contact: "+91 98220 22222", locationId: "sk-kharadi", unit: "K1-0602", categoryId: "electrical", priority: "High", sentiment: "Negative", tags: ["Common area"], assigneeId: "sk-u3", status: "In Progress", agoMins: 200 },
  ], now);
  return {
    customer: { id: "skyline", name: "Skyline Habitat Services", short: "SH", region: "Pune, India", ticketPrefix: "SKY", nextTicketNo: 311 },
    locations, roles, perms, users, categories, chains: chainsFor(categories), multipliers: defaultMultipliers(),
    declineReasons, routingRules: [], tickets, notifications: [],
    trend: { created: [6, 8, 5, 9, 7, 10, 8], resolved: [5, 7, 6, 8, 6, 9, 9] },
  };
}

/* ------------------------------------------------------------------ */
/* Licence Registry: Customer → Licence, Customer → Database           */
/* ------------------------------------------------------------------ */
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export function buildRegistry(now = Date.now()): Registry {
  const days = (n: number) => isoDate(new Date(now + n * 86400000));
  return {
    version: DEMO_VERSION,
    customers: [
      { customerId: "prestige", name: "Prestige Group", short: "PG", region: "Bengaluru, India", database: dbKey("prestige"),
        licence: { plan: "Business", validUntil: days(520), maxSites: 5, maxUsers: 25, modules: ["helpdesk", "sla", "ai", "reports", "migration"], pricePerSeat: 10 } },
      { customerId: "harbourline", name: "Harbourline Property Management", short: "HP", region: "United Kingdom", database: dbKey("harbourline"),
        licence: { plan: "Starter", validUntil: days(330), maxSites: 4, maxUsers: 10, modules: ["helpdesk", "sla", "reports"], pricePerSeat: 12 } },
      { customerId: "skyline", name: "Skyline Habitat Services", short: "SH", region: "Pune, India", database: dbKey("skyline"),
        licence: { plan: "Starter", validUntil: days(-12), maxSites: 2, maxUsers: 10, modules: ["helpdesk", "sla"], pricePerSeat: 12 } },
    ],
  };
}

const SEEDS: Record<string, (now: number) => Workspace> = { prestige, harbourline, skyline };

/** Provisions a fresh database for one customer (rule 5: new customer = new DB + registry entry). */
export const seedDatabase = (customerId: string, now = Date.now()): Workspace | undefined => SEEDS[customerId]?.(now);

/* ------------------------------------------------------------------ */
/* Simulated sign-in identities                                        */
/* ------------------------------------------------------------------ */
export const PERSONAS: Persona[] = [
  { id: "kavya", name: "Kavya Rao", title: "Zongovita operations · 3 customers", memberships: [{ customerId: "prestige", userId: "pr-u2", role: "Regional Admin" }, { customerId: "harbourline", userId: "hl-u9", role: "Regional Admin" }, { customerId: "skyline", userId: "sk-u2", role: "Regional Admin" }] },
  { id: "vikram", name: "Vikram Shetty", title: "Prestige · Customer Super Admin", memberships: [{ customerId: "prestige", userId: "pr-u1", role: "Customer Super Admin" }] },
  { id: "rohan", name: "Rohan Mehta", title: "Prestige · Regional Admin", memberships: [{ customerId: "prestige", userId: "pr-u3", role: "Regional Admin" }] },
  { id: "sneha", name: "Sneha Kulkarni", title: "Prestige · Site Manager", memberships: [{ customerId: "prestige", userId: "pr-u4", role: "Site Manager" }] },
  { id: "arjun", name: "Arjun Nair", title: "Prestige · Technician", memberships: [{ customerId: "prestige", userId: "pr-u6", role: "Technician" }] },
  { id: "olivia", name: "Olivia Price", title: "Harbourline · Super Admin", memberships: [{ customerId: "harbourline", userId: "hl-u1", role: "Super Admin" }] },
  { id: "hannah", name: "Hannah Reid", title: "Harbourline · Regional Admin", memberships: [{ customerId: "harbourline", userId: "hl-u2", role: "Regional Admin" }] },
  { id: "neha", name: "Neha Joshi", title: "Skyline · Super Admin (licence expired)", memberships: [{ customerId: "skyline", userId: "sk-u1", role: "Super Admin" }] },
  { id: "dana", name: "Dana Hughes", title: "Harbourline · Type 3 staff", memberships: [{ customerId: "harbourline", userId: "hl-u6", role: "Type 3" }] },
];

/** Full demo: the registry plus one separate database per customer. */
export function buildSeed(now = Date.now()): { registry: Registry; databases: Record<string, Workspace> } {
  const registry = buildRegistry(now);
  return { registry, databases: Object.fromEntries(registry.customers.map((c) => [c.customerId, seedDatabase(c.customerId, now)!])) };
}
