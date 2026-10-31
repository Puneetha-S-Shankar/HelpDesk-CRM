import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Workspace } from "./model.ts";
import { buildRegistry, buildSeed, dbKey, PERSONAS, seedDatabase } from "./seed.ts";
import {
  accessibleLocationIds, addNote, checkLicence, siteLimitReached, approveDecline, can, canDecline, createTicket, escalateTicket, notificationsFor, openCount,
  pendingDecline, reassignTicket, recommendStaff, rejectDecline, requestDecline, resolveTicket, slaInfo, topRecommendation, validateDecline, visibleTickets,
} from "./workflows.ts";

const NOW = Date.parse("2026-10-30T10:00:00Z");
const seed = () => buildSeed(NOW);
const ws = (id: "prestige" | "harbourline" | "skyline") => seed().databases[id];
const dbs = (s = seed()) => Object.values(s.databases);
const user = (w: Workspace, id: string) => w.users.find((u) => u.id === id)!;
const ticket = (w: Workspace, id: string) => w.tickets.find((t) => t.id === id)!;
const ok = (r: ReturnType<typeof requestDecline>) => { assert.ok(r.ok, r.ok ? "" : r.error); return r.ws; };

// PRS-1047 is In Progress, assigned to Arjun Nair (pr-u6) at Lakeside.
const declineArjun = (w: Workspace, reasonId = "skill", explanation = "") => requestDecline(w, "PRS-1047", user(w, "pr-u6"), { reasonId, explanation }, NOW + 60000);

describe("sample data integrity", () => {
  test("every ticket belongs to a location of its own customer, and assignees are local users", () => {
    for (const w of dbs()) {
      const locs = new Set(w.locations.map((l) => l.id));
      const users = new Set(w.users.map((u) => u.id));
      for (const t of w.tickets) {
        assert.ok(locs.has(t.locationId), `${t.id} location`);
        assert.ok(t.assigneeId === null || users.has(t.assigneeId), `${t.id} assignee`);
        assert.ok(w.categories.some((c) => c.id === t.categoryId), `${t.id} category`);
        assert.ok(t.id.startsWith(w.customer.ticketPrefix), `${t.id} prefix`);
      }
      for (const u of w.users) for (const l of u.locationIds) assert.ok(locs.has(l), `${u.name} location ${l}`);
    }
  });
  test("every persona membership resolves to a user in that customer", () => {
    const s = seed();
    for (const p of PERSONAS) for (const m of p.memberships) assert.ok(s.databases[m.customerId]?.users.some((u) => u.id === m.userId), `${p.name} → ${m.customerId}`);
  });
  test("no ids are shared between customer workspaces (tickets, users, locations)", () => {
    const [a, b, c] = dbs();
    for (const key of ["tickets", "users", "locations"] as const) {
      const ids = new Set(a[key].map((x) => x.id));
      assert.ok(b[key].every((x) => !ids.has(x.id)) && c[key].every((x) => !ids.has(x.id)), key);
    }
  });
});

describe("decline workflow", () => {
  test("a reason is mandatory", () => {
    const r = declineArjun(ws("prestige"), "");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /reason/i);
  });
  test('"Other" requires an explanation', () => {
    const w = ws("prestige");
    assert.ok(validateDecline(w, { reasonId: "other", explanation: "" }));
    assert.equal(declineArjun(w, "other", "short").ok, false);
    assert.equal(declineArjun(w, "other", "Family emergency, leaving site early").ok, true);
  });
  test("inactive reasons are rejected", () => {
    const w = ws("prestige");
    w.declineReasons = w.declineReasons.map((r) => (r.id === "busy" ? { ...r, active: false } : r));
    assert.equal(declineArjun(w, "busy").ok, false);
  });
  test("ticket moves to Pending Admin Review, assignee is preserved, request is recorded and admins are notified", () => {
    const w = ok(declineArjun(ws("prestige"), "scope", "Not my block"));
    const t = ticket(w, "PRS-1047");
    assert.equal(t.status, "Pending Admin Review");
    assert.equal(t.assigneeId, "pr-u6");
    const d = pendingDecline(t)!;
    assert.equal(d.reasonId, "scope");
    assert.equal(d.explanation, "Not my block");
    assert.equal(d.previousStatus, "In Progress");
    assert.equal(d.requestedAt, new Date(NOW + 60000).toISOString());
    assert.deepEqual(t.history.slice(0, 2).map((e) => e.type), ["decline_reason", "decline_requested"]);
    // Rohan (regional, Lakeside + Shantiniketan) is notified; Sneha (Falcon City only) is not.
    assert.ok(notificationsFor(w, user(w, "pr-u3")).some((n) => n.ticketId === "PRS-1047"));
    assert.ok(!notificationsFor(w, user(w, "pr-u4")).some((n) => n.ticketId === "PRS-1047"));
  });
  test("only the assignee can decline, and not twice", () => {
    const w = ws("prestige");
    assert.equal(requestDecline(w, "PRS-1047", user(w, "pr-u8"), { reasonId: "skill", explanation: "" }, NOW).ok, false);
    const w2 = ok(declineArjun(w));
    assert.equal(canDecline(w2, user(w2, "pr-u6"), ticket(w2, "PRS-1047")), false);
    assert.equal(declineArjun(w2).ok, false);
  });
  test("admins without the decline permission cannot decline", () => {
    const w = ws("prestige");
    assert.equal(can(w, user(w, "pr-u1"), "decline"), false);
  });
});

describe("admin review workflow", () => {
  const pending = () => ok(declineArjun(ws("prestige")));
  const rohan = (w: Workspace) => user(w, "pr-u3");

  test("approve and return to team queue", () => {
    const w0 = pending();
    const w = ok(approveDecline(w0, "PRS-1047", rohan(w0), { kind: "queue" }, "", NOW + 120000));
    const t = ticket(w, "PRS-1047");
    assert.equal(t.assigneeId, null);
    assert.equal(t.status, "Open");
    assert.equal(t.declines.at(-1)!.state, "approved");
    assert.equal(t.declines.at(-1)!.reviewedById, "pr-u3");
    assert.deepEqual(t.history.slice(0, 2).map((e) => e.type), ["queued", "decline_approved"]);
    assert.ok(notificationsFor(w, user(w, "pr-u6")).some((n) => n.title.startsWith("Decline approved")));
  });
  test("approve and assign back to the same staff member restores the previous status", () => {
    const w0 = pending();
    const t = ticket(ok(approveDecline(w0, "PRS-1047", rohan(w0), { kind: "user", userId: "pr-u6" }, "", NOW)), "PRS-1047");
    assert.equal(t.assigneeId, "pr-u6");
    assert.equal(t.status, "In Progress");
  });
  test("approve and reassign to a different staff member notifies them", () => {
    const w0 = pending();
    const w = ok(approveDecline(w0, "PRS-1047", rohan(w0), { kind: "user", userId: "pr-u12" }, "Ravi covers plumbing today", NOW));
    const t = ticket(w, "PRS-1047");
    assert.equal(t.assigneeId, "pr-u12");
    assert.equal(t.status, "Open");
    assert.equal(t.history[0].type, "reassigned");
    assert.equal(t.history[1].detail, "Ravi covers plumbing today");
    assert.ok(notificationsFor(w, user(w, "pr-u12")).some((n) => n.ticketId === "PRS-1047"));
  });
  test("reject requires a comment and returns the ticket to the original assignee", () => {
    const w0 = pending();
    assert.equal(rejectDecline(w0, "PRS-1047", rohan(w0), "  ", NOW).ok, false);
    const w = ok(rejectDecline(w0, "PRS-1047", rohan(w0), "You are the only plumber on shift.", NOW));
    const t = ticket(w, "PRS-1047");
    assert.equal(t.assigneeId, "pr-u6");
    assert.equal(t.status, "In Progress");
    assert.equal(t.declines.at(-1)!.state, "rejected");
    assert.equal(t.declines.at(-1)!.reviewComment, "You are the only plumber on shift.");
    assert.ok(t.history.some((e) => e.type === "decline_rejected"));
    assert.ok(notificationsFor(w, user(w, "pr-u6")).some((n) => n.title.startsWith("Decline rejected")));
  });
  test("reviewers are limited to their locations", () => {
    const w0 = pending();
    // Sneha is a Site Manager for Falcon City only; PRS-1047 is at Lakeside.
    assert.equal(approveDecline(w0, "PRS-1047", user(w0, "pr-u4"), { kind: "queue" }, "", NOW).ok, false);
    // Arjun (Technician) has no review permission.
    assert.equal(rejectDecline(w0, "PRS-1047", user(w0, "pr-u6"), "nope nope", NOW).ok, false);
  });
  test("a pending ticket cannot be reassigned directly or resolved", () => {
    const w0 = pending();
    assert.equal(reassignTicket(w0, "PRS-1047", rohan(w0), { kind: "queue" }, NOW).ok, false);
    assert.equal(resolveTicket(w0, "PRS-1047", rohan(w0), NOW).ok, false);
  });
});

describe("recommendations", () => {
  test("lift ticket at Lakeside recommends a lift-skilled, available staff member assigned there", () => {
    const w = ws("prestige");
    const cands = recommendStaff(w, ticket(w, "PRS-1048"));
    const top = topRecommendation(cands)!;
    assert.equal(top.user.id, "pr-u12"); // Ravi Teja: Lift skill, Lakeside, Available
    assert.ok(top.reasons.every((r) => r.ok));
    const arjun = cands.find((c) => c.user.id === "pr-u6")!;
    assert.equal(arjun.isOriginal, true);
    assert.equal(arjun.eligible, false); // no Lift skill
    assert.equal(cands.find((c) => c.user.id === "pr-u11")!.eligible, false); // Imran has Lift but is at Falcon City
  });
  test("only staff tiers are candidates", () => {
    const w = ws("prestige");
    const ids = recommendStaff(w, ticket(w, "PRS-1048")).map((c) => c.user.id);
    assert.ok(!ids.includes("pr-u1") && !ids.includes("pr-u2"));
  });
  test("workload is live", () => {
    const w = ws("prestige");
    assert.equal(openCount(w, "pr-u6"), 2);
  });
});

describe("multi-customer access", () => {
  test("location scoping by role", () => {
    const w = ws("prestige");
    assert.equal(accessibleLocationIds(w, user(w, "pr-u1")).length, 3); // super: all
    assert.deepEqual(accessibleLocationIds(w, user(w, "pr-u3")).sort(), ["pr-lakeside", "pr-shanti"]);
    assert.deepEqual(accessibleLocationIds(w, user(w, "pr-u4")), ["pr-falcon"]);
    assert.ok(visibleTickets(w, user(w, "pr-u4")).every((t) => t.locationId === "pr-falcon"));
    assert.ok(visibleTickets(w, user(w, "pr-u1"), "pr-shanti").every((t) => t.locationId === "pr-shanti"));
  });
  test("super admin scope covers locations added later", () => {
    const w = ws("prestige");
    w.locations = [...w.locations, { ...w.locations[0], id: "pr-new", name: "New site" }];
    assert.ok(accessibleLocationIds(w, user(w, "pr-u1")).includes("pr-new"));
    assert.ok(!accessibleLocationIds(w, user(w, "pr-u3")).includes("pr-new"));
  });
  test("configurations are independent: same category id, different SLA, different role names", () => {
    const s = seed();
    const { prestige: p, harbourline: h } = s.databases;
    assert.notEqual(p.categories.find((c) => c.id === "plumbing"), h.categories.find((c) => c.id === "plumbing"));
    assert.equal(p.roles.find((r) => r.id === "t1")!.name, "Site Manager");
    assert.equal(h.roles.find((r) => r.id === "t1")!.name, "Type 1");
    assert.equal(p.perms.t1.review, true);
    assert.equal(h.perms.t1.review, false);
    assert.ok(h.declineReasons.some((r) => r.id === "gas") && !p.declineReasons.some((r) => r.id === "gas"));
  });
  test("mutating one workspace leaves the other untouched", () => {
    const s = seed();
    const before = JSON.stringify(s.databases.harbourline);
    const p = s.databases.prestige;
    ok(declineArjun(p));
    ok(createTicket(p, user(p, "pr-u1"), { title: "Test", description: "", tenant: "A", contact: "", channel: "Inbound call", locationId: "pr-falcon", unit: "1", categoryId: "plumbing", priority: "Low", sentiment: "Neutral", tags: [], target: { kind: "queue" } }, NOW));
    assert.equal(JSON.stringify(s.databases.harbourline), before);
  });
  test("a user cannot act on another customer's ticket", () => {
    const s = seed();
    const { prestige: p, harbourline: h } = s.databases;
    // Prestige admin acting in the Harbourline workspace has no user there.
    assert.equal(approveDecline(h, "HD-24887", user(p, "pr-u1"), { kind: "queue" }, "", NOW).ok, false);
    assert.equal(ticket(h, "PRS-1047" as string), undefined);
  });
});

describe("other ticket actions", () => {
  test("create ticket uses the customer prefix and records history", () => {
    const w0 = ws("harbourline");
    const r = createTicket(w0, user(w0, "hl-u1"), { title: "Broken window", description: "Cracked pane", tenant: "Sam", contact: "", channel: "Inbound call", locationId: "hl-foundry", unit: "3A", categoryId: "plumbing", priority: "High", sentiment: "Neutral", tags: [], target: { kind: "user", userId: "hl-u6" } }, NOW);
    const w = ok(r);
    const t = ticket(w, "HD-24892");
    assert.equal(t.assigneeId, "hl-u6");
    assert.equal(w.customer.nextTicketNo, 24893);
    assert.equal(t.history.at(-1)!.type, "created");
  });
  test("create ticket rejects locations outside the creator's scope", () => {
    const w = ws("prestige");
    const r = createTicket(w, user(w, "pr-u6"), { title: "X", description: "", tenant: "A", contact: "", channel: "Inbound call", locationId: "pr-falcon", unit: "1", categoryId: "plumbing", priority: "Low", sentiment: "Neutral", tags: [], target: { kind: "queue" } }, NOW);
    assert.equal(r.ok, false);
  });
  test("direct reassign, escalate, note, resolve", () => {
    let w = ws("harbourline");
    const olivia = user(w, "hl-u1");
    w = ok(reassignTicket(w, "HD-24890", olivia, { kind: "user", userId: "hl-u5" }, NOW));
    assert.equal(ticket(w, "HD-24890").assigneeId, "hl-u5");
    w = ok(escalateTicket(w, "HD-24890", olivia, NOW));
    assert.equal(ticket(w, "HD-24890").status, "Escalated");
    w = ok(addNote(w, "HD-24890", olivia, "Called tenant", NOW));
    assert.equal(ticket(w, "HD-24890").history[0].detail, "Called tenant");
    w = ok(resolveTicket(w, "HD-24890", olivia, NOW));
    assert.equal(ticket(w, "HD-24890").status, "Resolved");
  });
  test("SLA uses the customer's category policy and priority multiplier", () => {
    const w = ws("harbourline");
    const t = ticket(w, "HD-24884"); // Electrical 480m × High 0.5 = 240m, created 256m ago
    assert.equal(slaInfo(w, t, NOW).state, "Breached");
    w.categories = w.categories.map((c) => (c.id === "electrical" ? { ...c, resolveMins: 1440 } : c));
    assert.equal(slaInfo(w, t, NOW).state, "Within SLA");
  });
});

describe("ZongoVita multi-tenant standard", () => {
  test("rule 1: one database per customer, each holding only its own customer's data", () => {
    const s = seed();
    for (const e of s.registry.customers) {
      assert.equal(e.database, dbKey(e.customerId));
      const db = s.databases[e.customerId];
      assert.equal(db.customer.id, e.customerId);
      assert.ok(db.tickets.every((t) => t.id.startsWith(db.customer.ticketPrefix)));
    }
    assert.equal(new Set(s.registry.customers.map((e) => e.database)).size, s.registry.customers.length);
  });
  test("rule 2: sites live inside their customer's database", () => {
    for (const db of dbs()) assert.ok(db.locations.length > 0 && db.tickets.every((t) => db.locations.some((l) => l.id === t.locationId)));
  });
  test("licence registry holds no customer business data", () => {
    const reg = buildRegistry(NOW);
    for (const e of reg.customers) assert.deepEqual(Object.keys(e).sort(), ["customerId", "database", "licence", "name", "region", "short"]);
    const json = JSON.stringify(reg);
    for (const banned of ["tickets", "users", "locations", "PRS-", "HD-"]) assert.ok(!json.includes(banned), banned);
  });
  test("rule 4: expired licence blocks the customer; valid licence passes", () => {
    const reg = buildRegistry(NOW);
    const get = (id: string) => reg.customers.find((c) => c.customerId === id);
    assert.equal(checkLicence(get("prestige"), NOW).ok, true);
    const sky = checkLicence(get("skyline"), NOW);
    assert.equal(sky.ok, false);
    assert.match((sky as { reason: string }).reason, /blocked/);
    assert.equal(checkLicence(undefined, NOW).ok, false);
  });
  test("licence caps the number of sites", () => {
    const reg = buildRegistry(NOW);
    const sky = reg.customers.find((c) => c.customerId === "skyline")!;
    assert.equal(siteLimitReached(sky, ws("skyline")), true);
    assert.equal(siteLimitReached(reg.customers[0], ws("prestige")), false);
  });
  test("rule 5: a new customer is a new database + one registry entry; existing customers unchanged", () => {
    const before = seed(); const snapshot = JSON.stringify(before.databases);
    const fresh = seedDatabase("skyline", NOW)!;
    assert.equal(fresh.customer.id, "skyline");
    assert.equal(JSON.stringify(before.databases), snapshot);
  });
  test("rule 3: every persona's customers come from its memberships only", () => {
    for (const p of PERSONAS) assert.ok(p.memberships.length > 0 && p.memberships.every((m) => buildRegistry(NOW).customers.some((c) => c.customerId === m.customerId)));
  });
});
