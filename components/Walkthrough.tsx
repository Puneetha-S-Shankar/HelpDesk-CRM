"use client";

import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useEnterprise, type User } from "./Enterprise";

type Stage = "raise" | "created" | "enriched" | "routed" | "queued" | "accepted" | "working" | "closed";
type RoleId = "tenant" | "coordinator" | "assignee" | "escalation" | "manager" | "super";
type Priority = "Urgent" | "High" | "Normal" | "Low";
type EscLevel = 0 | 1 | 2 | 3;
type Avail = "Available" | "On call" | "Unavailable";
type SpotId =
  | "raise-form"
  | "ticket-card"
  | "ai-tags"
  | "route-block"
  | "role-strip"
  | "queue-row"
  | "actions"
  | "sla-panel"
  | "status-badge"
  | "next-btn"
  | "ownership"
  | "esc-panel";

type AssignHist = { from: string; to: string; reason: string };
type HandoffAnim = { from: string; to: string; reason: string; phase: "leaving" | "moving" | "landed"; id: number };
type TrackStep = { name: string; tag: string; state: "past" | "current" | "leaving" | "entering" };

type WalkTicket = {
  id: string;
  tenant: string;
  property: string;
  unit: string;
  lease: string;
  channel: string;
  category: string;
  notes: string;
  priority: Priority;
  sentiment: string;
  sentimentScore: number;
  urgencyTags: string[];
  confidence: number;
  primary: string;
  backup: string;
  manager: string;
  status: string;
  responseMins: number;
  resolveMins: number;
  staffNotes: string[];
  escalated: boolean;
  escLevel: EscLevel;
  ackBy: string | null;
  declined: string[];
  assignHistory: AssignHist[];
};

type SpotRect = { top: number; left: number; width: number; height: number };

const STAGES: { id: Stage; label: string }[] = [
  { id: "raise", label: "Raise issue" },
  { id: "created", label: "Ticket created" },
  { id: "enriched", label: "AI enriched" },
  { id: "routed", label: "Assigned & SLA" },
  { id: "queued", label: "In queue" },
  { id: "accepted", label: "Accepted" },
  { id: "working", label: "Working" },
  { id: "closed", label: "Closed" },
];

const ROLES: { id: RoleId; label: string; person: string; permKey: string | null }[] = [
  { id: "tenant", label: "Tenant", person: "Maya Patel", permKey: null },
  { id: "coordinator", label: "Coordinator", person: "Olivia Price", permKey: "super" },
  { id: "assignee", label: "Assignee", person: "Dana Hughes", permKey: "t3" },
  { id: "escalation", label: "Escalation L1", person: "Priya Shah", permKey: "t2" },
  { id: "manager", label: "Manager", person: "Ruth Allen", permKey: "t1" },
  { id: "super", label: "Super Admin", person: "Olivia Price", permKey: "super" },
];

const CATEGORIES = ["Heating", "Plumbing", "Electrical", "Access", "Lift", "Noise", "Safeguarding"];
const STAGE_ORDER: Stage[] = STAGES.map((s) => s.id);
const PAD = 8;

const ESC_META: Record<1 | 2 | 3, { who: string; mins: number; role: RoleId }> = {
  1: { who: "Priya Shah (Type 2)", mins: 30, role: "escalation" },
  2: { who: "Ruth Allen, James Cole, Hannah Reid", mins: 15, role: "manager" },
  3: { who: "Olivia Price (Super Admin)", mins: 10, role: "super" },
};

function fmtMins(m: number) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function analyzeNotes(notes: string, category: string) {
  const n = notes.toLowerCase();
  const urgent =
    /no heat|boiler|child|cold|14°|14c|vulnerable|emergency|flood|fire|safeguard|heating/.test(n) ||
    category === "Safeguarding";
  const tags: string[] = [];
  if (/heat|boiler|cold|14/.test(n) || category === "Heating") tags.push("No heating");
  if (/child|baby|infant|vulnerable/.test(n)) tags.push("Child present");
  if (/cold|14|temperature/.test(n)) tags.push("Low temperature");
  if (/access|lock|key/.test(n) || category === "Access") tags.push("Access blocked");
  if (tags.length === 0) tags.push(category);
  const negative = urgent || /angry|upset|frustrated|complaint/.test(n);
  return {
    priority: (urgent ? "Urgent" : "Normal") as Priority,
    sentiment: negative ? "Negative" : "Neutral",
    sentimentScore: negative ? -0.72 : 0.12,
    urgencyTags: tags.slice(0, 3),
    confidence: 94,
  };
}

function rankAvail(a: Avail) {
  return a === "Available" ? 0 : a === "On call" ? 1 : 2;
}

function managerFor(category: string) {
  return category === "Safeguarding" ? "James Cole" : "Ruth Allen";
}

function pickAssignees(
  users: User[],
  category: string,
  declined: string[],
  sessionAvail: Record<string, Avail>,
) {
  const pool = users
    .filter((u) => u.skills.includes(category) && !declined.includes(u.name))
    .map((u) => ({
      ...u,
      availability: sessionAvail[u.name] ?? u.availability,
    }))
    .filter((u) => u.availability !== "Unavailable")
    .sort((a, b) => rankAvail(a.availability) - rankAvail(b.availability) || a.open - b.open);
  return {
    primary: pool[0]?.name ?? "",
    backup: pool[1]?.name ?? "—",
    pool,
  };
}

function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function shortTag(tag: string): string {
  const t = tag.toLowerCase();
  if (t.includes("declin")) return "declined";
  if (t.includes("busy") || t.includes("unavail")) return "busy";
  if (t.includes("accept")) return "accepted";
  if (t.includes("resolv")) return "resolved";
  if (t.includes("route") || t === "start") return "route";
  if (t.includes("waiting") || t.includes("holding")) return t.includes("waiting") ? "waiting" : "holding";
  if (t.includes("no ") || t.includes("staff free")) return "waiting";
  return tag.length > 18 ? `${tag.slice(0, 16)}…` : tag;
}

function OwnershipBoard({
  ticket,
  stage,
  handoff,
  track,
}: {
  ticket: WalkTicket;
  stage: Stage;
  handoff: HandoffAnim | null;
  track: TrackStep[];
}) {
  const holding = ticket.primary || "Unassigned";
  const closed = stage === "closed";
  const accepted = stage === "accepted" || stage === "working" || closed;
  const unassigned = !ticket.primary;
  const lastReason = ticket.assignHistory[ticket.assignHistory.length - 1]?.reason;
  const hasBackup = !!ticket.backup && ticket.backup !== "—";
  const sub = closed
    ? "Resolved · handoff frozen"
    : accepted
      ? "Accepted · handoff frozen until escalate / reassign"
      : unassigned
        ? "No skilled staff free · open escalation"
        : [hasBackup ? `Backup ${ticket.backup}` : null, lastReason].filter(Boolean).join(" · ") || "Primary on this ticket";

  return (
    <div
      className={`walk-own ${handoff ? `walk-own-${handoff.phase}` : ""} ${unassigned ? "walk-own-empty" : ""} ${accepted ? "walk-own-accepted" : ""} ${closed ? "walk-own-closed" : ""}`}
      data-walk-spot="ownership"
    >
      <div className="walk-own-now">
        <small>Now holding</small>
        <strong className={handoff?.phase === "landed" || !handoff ? "walk-own-land" : ""}>
          {holding}
          {accepted && !unassigned && (
            <span className={`walk-own-accepted-badge ${closed ? "is-resolved" : ""}`}>{closed ? "Resolved" : "Accepted"}</span>
          )}
        </strong>
        <span>{sub}</span>
        {unassigned && !ticket.escalated && (
          <em className="walk-own-cta">Use Open escalation in Actions below</em>
        )}
      </div>
      <div className="walk-own-track" aria-label="Assignment handoff track">
        {track.map((step, i) => (
          <div key={`${step.name}-${i}`} className="walk-own-step-wrap">
            {i > 0 && (
              <span
                className={`walk-own-arrow ${handoff && i === track.length - 1 && (handoff.phase === "leaving" || handoff.phase === "moving") ? "pulse" : ""}`}
                aria-hidden
              />
            )}
            <div
              className={`walk-own-chip walk-own-chip-${step.state} ${step.name === "Unassigned" ? "is-empty" : ""} ${step.tag === "accepted" || step.tag === "resolved" ? "is-ok" : ""}`}
            >
              <strong>{step.name}</strong>
              <small>{shortTag(step.tag)}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tipFor(stage: Stage, ticket: WalkTicket | null, spot: SpotId, escalated: boolean): { title: string; body: string } {
  if (stage === "raise" || !ticket) {
    return { title: "Raise an issue", body: "Fill the form and press Raise issue. Stages advance only when you choose." };
  }
  if (spot === "ownership") {
    const who = ticket?.primary || "Unassigned";
    return { title: "Who holds this ticket", body: `Now holding: ${who}. Decline or Busy moves the chip along the track — watch this board only.` };
  }
  if (spot === "esc-panel" || escalated) {
    const lv = (ticket.escLevel || 1) as 1 | 2 | 3;
    return { title: `Escalation level ${lv}`, body: `${ESC_META[lv].who} must act within ${ESC_META[lv].mins}m. Advance only notifies the next level — it does not resolve the ticket.` };
  }
  if (stage === "created") {
    return { title: "Ticket created", body: `${ticket.id} linked to ${ticket.property} ${ticket.unit}. Press Go to next stage for AI enrichment.` };
  }
  if (stage === "enriched") {
    return { title: "AI enrichment", body: `${ticket.sentiment} · ${ticket.priority}. Next: skill-based assignment.` };
  }
  if (stage === "routed") {
    return { title: "Assigned & SLA", body: `Primary ${ticket.primary || "Unassigned"} · backup ${ticket.backup}.` };
  }
  if (stage === "queued") {
    return { title: "In queue", body: "Accept, Decline, or mark Busy. Busy / Decline reassigns by skill and availability — watch the names change." };
  }
  if (stage === "accepted" || stage === "working") {
    return { title: "Work the ticket", body: ticket.primary ? `Assigned to ${ticket.primary}. Add notes, then Resolve when done.` : "No assignee yet — escalate or free a skilled person first." };
  }
  return { title: "Closed", body: `${ticket.id} is resolved by ${ticket.primary || "staff"}. Start over for another issue.` };
}

export default function Walkthrough() {
  const { categories, multipliers, perms, users } = useEnterprise();
  const [stage, setStage] = useState<Stage>("raise");
  const [role, setRole] = useState<RoleId>("tenant");
  const [ticket, setTicket] = useState<WalkTicket | null>(null);
  const [timeline, setTimeline] = useState<{ t: string; text: string; kind: string }[]>([]);
  const [tenantName, setTenantName] = useState("Maya Patel");
  const [channel, setChannel] = useState("Inbound call");
  const [category, setCategory] = useState("Heating");
  const [notes, setNotes] = useState("Boiler stopped overnight. Flat is 14°C and there is a young child in the property. Restart failed.");
  const [noteDraft, setNoteDraft] = useState("");
  const [sessionAvail, setSessionAvail] = useState<Record<string, Avail>>({});
  const [spotOverride, setSpotOverride] = useState<SpotId | null>(null);
  const [spotlightOn, setSpotlightOn] = useState(true);
  const [hole, setHole] = useState<SpotRect>({ top: 0, left: 0, width: 0, height: 0 });
  const [tipAbove, setTipAbove] = useState(false);
  const [handoff, setHandoff] = useState<HandoffAnim | null>(null);

  const stageIndex = STAGE_ORDER.indexOf(stage);
  const roleMeta = ROLES.find((r) => r.id === role)!;
  const assigneeName = ticket?.primary || "Unassigned";
  const rolePerson = role === "assignee" ? (ticket?.primary || roleMeta.person) : roleMeta.person;
  const canManualNext = !!ticket && (stage === "created" || stage === "enriched" || stage === "routed");
  const canResolve =
    !!ticket &&
    !ticket.escalated &&
    !!ticket.primary &&
    ticket.status !== "Unassigned" &&
    ((role === "assignee" && (stage === "accepted" || stage === "working")) ||
      ((role === "coordinator" || role === "super") && (stage === "accepted" || stage === "working")));

  const activeSpot: SpotId = useMemo(() => {
    if (spotOverride) return spotOverride;
    if (stage === "raise" || !ticket) return "raise-form";
    if (ticket.escalated) return "esc-panel";
    if (stage === "created") return "ticket-card";
    if (stage === "enriched") return "ai-tags";
    if (stage === "routed" || stage === "queued") return "ownership";
    if (stage === "accepted" || stage === "working") return handoff ? "ownership" : "actions";
    if (stage === "closed") return "status-badge";
    return "ticket-card";
  }, [spotOverride, stage, ticket, handoff]);

  const wakeSpotlight = useCallback((spot?: SpotId | null) => {
    setSpotlightOn(true);
    if (spot !== undefined) setSpotOverride(spot);
  }, []);

  const measure = useCallback(() => {
    const el = document.querySelector(`[data-walk-spot="${activeSpot}"]`) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = Math.max(4, r.top - PAD);
    const left = Math.max(4, r.left - PAD);
    const width = Math.min(window.innerWidth - left - 4, r.width + PAD * 2);
    const height = Math.min(window.innerHeight - top - 4, r.height + PAD * 2);
    setHole({ top, left, width, height });
    setTipAbove(r.bottom + 140 > window.innerHeight);
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSpot]);

  useLayoutEffect(() => {
    if (!spotlightOn) return;
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const id = window.setTimeout(measure, 40);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.clearTimeout(id);
    };
  }, [measure, spotlightOn, stage, role, ticket?.primary, ticket?.status, ticket?.escLevel, handoff?.id, handoff?.phase]);

  const can = useMemo(() => {
    if (role === "tenant") return { view: true, create: false, edit: false, reassign: false };
    const p = perms[roleMeta.permKey!];
    return { view: !!p?.view, create: !!p?.create, edit: !!p?.edit, reassign: !!p?.reassign };
  }, [role, roleMeta.permKey, perms]);

  const roleInvolved = (() => {
    if (!ticket) return "Raise an issue to start. Stages advance only when you press Go to next stage.";
    if (role === "tenant") return "Your request status and notes only. No staff actions.";
    if (ticket.escalated) {
      const lv = ticket.escLevel as 1 | 2 | 3;
      return `Escalation L${lv}: ${ESC_META[lv].who}. Acknowledge to return the ticket to the skill pool — Advance only notifies the next level.`;
    }
    if (role === "assignee") {
      if (!ticket.primary) return "Nobody with this skill is free. Switch to Coordinator and open escalation.";
      if (stage === "queued") return `${assigneeName} is primary. Accept, Decline, or mark Busy — names update when ownership moves.`;
      if (stage === "accepted" || stage === "working") return `You own this as ${ticket.primary}. Resolve only when the work is done.`;
      if (stage === "closed") return `${ticket.primary} closed this ticket.`;
      return `${assigneeName} is the routed primary.`;
    }
    if (role === "escalation") return "Priya Shah is Level 1. She is involved only after escalation starts.";
    if (role === "manager") return "Ruth Allen (or James Cole on Safeguarding) is Type 1 on the property rule.";
    if (role === "coordinator") return "Full detail. Mark assignee busy, open escalation if the pool is empty, or reassign via decline.";
    return "Super Admin lens: every panel and action the matrix allows.";
  })();

  const applyRoute = (t: WalkTicket, avail = sessionAvail, declined = t.declined): WalkTicket => {
    const picked = pickAssignees(users, t.category, declined, avail);
    const nextStatus = !picked.primary
      ? "Unassigned"
      : t.status === "Unassigned" || t.status === "Escalated"
        ? "Open"
        : t.status === "Resolved"
          ? "Resolved"
          : t.status;
    return {
      ...t,
      declined,
      primary: picked.primary,
      backup: picked.backup || "—",
      manager: managerFor(t.category),
      status: nextStatus,
    };
  };

  const showReassign = (from: string, to: string, reason: string, next: WalkTicket) => {
    const hist = { from: from || "Unassigned", to: to || "Unassigned", reason };
    const withHist = { ...next, assignHistory: [...(next.assignHistory || []), hist] };
    const id = Date.now();
    setTicket(withHist);
    setRole(to ? "assignee" : "coordinator");
    wakeSpotlight("ownership");
    setHandoff({ ...hist, phase: "leaving", id });
    window.setTimeout(() => setHandoff((h) => (h && h.id === id ? { ...h, phase: "moving" } : h)), 280);
    window.setTimeout(() => setHandoff((h) => (h && h.id === id ? { ...h, phase: "landed" } : h)), 560);
    window.setTimeout(() => {
      setHandoff((h) => (h && h.id === id ? null : h));
      setSpotOverride("actions");
    }, 900);
    window.setTimeout(() => setSpotOverride(null), 2400);
  };

  const buildTrack = (t: WalkTicket): TrackStep[] => {
    const hist = t.assignHistory || [];
    const steps: TrackStep[] = [];
    if (hist.length === 0) {
      return [{ name: t.primary || "Unassigned", tag: t.primary ? "holding" : "waiting", state: "current" }];
    }
    steps.push({ name: hist[0].from, tag: "route", state: "past" });
    hist.forEach((h, i) => {
      const isLast = i === hist.length - 1;
      let tag = h.reason;
      if (isLast) {
        if (stage === "closed") tag = "resolved";
        else if (stage === "accepted" || stage === "working") tag = "accepted";
        else if (!h.to || h.to === "Unassigned") tag = "waiting";
        else tag = "holding";
      } else {
        // Why this person left = reason on the next handoff
        tag = hist[i + 1]?.reason || h.reason;
      }
      steps.push({ name: h.to || "Unassigned", tag, state: isLast ? "current" : "past" });
    });
    if (handoff && steps.length >= 2) {
      const fromIdx = steps.length - 2;
      const toIdx = steps.length - 1;
      if (handoff.phase === "leaving") {
        steps[fromIdx] = { ...steps[fromIdx], state: "leaving", tag: handoff.reason };
        steps[toIdx] = { ...steps[toIdx], state: "entering", tag: handoff.to === "Unassigned" || !handoff.to ? "waiting" : "holding" };
      } else if (handoff.phase === "moving") {
        steps[fromIdx] = { ...steps[fromIdx], state: "past", tag: handoff.reason };
        steps[toIdx] = { ...steps[toIdx], state: "entering", tag: handoff.to === "Unassigned" || !handoff.to ? "waiting" : "holding" };
      } else {
        steps[toIdx] = {
          ...steps[toIdx],
          state: "current",
          tag: handoff.to === "Unassigned" || !handoff.to ? "waiting" : "holding",
        };
      }
    }
    return steps;
  };

  const raiseIssue = () => {
    if (!notes.trim()) return;
    const cat = categories.find((c) => c.name === category);
    const ai = analyzeNotes(notes, category);
    const mult = multipliers[ai.priority] ?? 1;
    const responseMins = Math.max(1, Math.round((cat?.responseMins ?? 60) * mult));
    const resolveMins = Math.max(1, Math.round((cat?.resolveMins ?? 480) * mult));
    const id = `HD-W${String(1000 + Math.floor(Math.random() * 8000))}`;
    let next: WalkTicket = {
      id,
      tenant: tenantName.trim() || "Maya Patel",
      property: "The Foundry",
      unit: "4B",
      lease: "L-10482",
      channel,
      category,
      notes: notes.trim(),
      priority: ai.priority,
      sentiment: ai.sentiment,
      sentimentScore: ai.sentimentScore,
      urgencyTags: ai.urgencyTags,
      confidence: ai.confidence,
      primary: "",
      backup: "—",
      manager: managerFor(category),
      status: "Open",
      responseMins,
      resolveMins,
      staffNotes: [],
      escalated: false,
      escLevel: 0,
      ackBy: null,
      declined: [],
      assignHistory: [],
    };
    next = applyRoute(next, sessionAvail, []);
    setTicket(next);
    setStage("created");
    setRole("tenant");
    setHandoff(null);
    wakeSpotlight(null);
    setTimeline([{ t: "now", text: `Issue raised by ${next.tenant} · ${next.channel}`, kind: "crm" }]);
  };

  const goNextStage = () => {
    if (!ticket) return;
    wakeSpotlight(null);
    if (stage === "created") {
      setTimeline((p) => [...p, { t: "step", text: `Ticket ${ticket.id} linked to ${ticket.property} ${ticket.unit} · lease ${ticket.lease}`, kind: "crm" }]);
      setStage("enriched");
      return;
    }
    if (stage === "enriched") {
      setTimeline((p) => [
        ...p,
        { t: "step", text: `AI: ${ticket.category} · ${ticket.sentiment} (${ticket.sentimentScore}) · ${ticket.priority}`, kind: "ai" },
      ]);
      setStage("routed");
      return;
    }
    if (stage === "routed") {
      const routed = applyRoute(ticket);
      const hist =
        routed.primary
          ? [{ from: "Queue", to: routed.primary, reason: "initial skill route" }]
          : [{ from: "Queue", to: "Unassigned", reason: `no ${ticket.category} staff free` }];
      setTicket({ ...routed, assignHistory: hist });
      setTimeline((p) => [
        ...p,
        {
          t: "step",
          text: routed.primary
            ? `Routed ${routed.primary} (primary) → ${routed.backup} (backup) · SLA respond ${fmtMins(routed.responseMins)}`
            : `No skilled staff available for ${routed.category} · ticket Unassigned`,
          kind: "system",
        },
      ]);
      setStage("queued");
      setRole(routed.primary ? "assignee" : "coordinator");
      wakeSpotlight("ownership");
      const id = Date.now();
      setHandoff({ from: "Queue", to: routed.primary || "Unassigned", reason: "initial skill route", phase: "moving", id });
      window.setTimeout(() => setHandoff((h) => (h && h.id === id ? { ...h, phase: "landed" } : h)), 400);
      window.setTimeout(() => setHandoff((h) => (h && h.id === id ? null : h)), 1200);
    }
  };

  const reset = () => {
    setStage("raise");
    setTicket(null);
    setTimeline([]);
    setRole("tenant");
    setNoteDraft("");
    setSessionAvail({});
    setSpotOverride(null);
    setSpotlightOn(true);
    setHandoff(null);
  };

  const accept = () => {
    if (!ticket || role !== "assignee" || stage !== "queued" || !ticket.primary) return;
    setTicket({ ...ticket, status: "In Progress" });
    setTimeline((p) => [...p, { t: "act", text: `${ticket.primary} accepted assignment`, kind: "staff" }]);
    setStage("accepted");
    wakeSpotlight("ownership");
    window.setTimeout(() => setSpotOverride("actions"), 1100);
    window.setTimeout(() => setSpotOverride(null), 2600);
  };

  const markBusy = () => {
    if (!ticket) return;
    if (!(role === "assignee" || role === "coordinator" || role === "super")) return;
    if (!(stage === "queued" || stage === "routed")) return;
    const who = ticket.primary;
    if (!who) return;
    const nextAvail = { ...sessionAvail, [who]: "Unavailable" as Avail };
    setSessionAvail(nextAvail);
    const next = applyRoute(ticket, nextAvail, ticket.declined);
    setTimeline((p) => [
      ...p,
      {
        t: "act",
        text: next.primary
          ? `${who} unavailable · reassigned to ${next.primary} (${ticket.category} skill)`
          : `${who} unavailable · nobody left with ${ticket.category} · Unassigned`,
        kind: "system",
      },
    ]);
    showReassign(who, next.primary, "busy / unavailable", next);
  };

  const decline = () => {
    if (!ticket || role !== "assignee" || stage !== "queued" || !ticket.primary) return;
    const who = ticket.primary;
    const declined = [...ticket.declined, who];
    const next = applyRoute({ ...ticket, declined }, sessionAvail, declined);
    setTimeline((p) => [
      ...p,
      {
        t: "act",
        text: next.primary
          ? `${who} declined · reassigned to ${next.primary}`
          : `${who} declined · no eligible staff · Unassigned on team queue`,
        kind: "staff",
      },
    ]);
    showReassign(who, next.primary, "declined", next);
  };

  const addNote = () => {
    if (!ticket || !noteDraft.trim()) return;
    if (!(role === "assignee" || role === "coordinator" || role === "super" || role === "manager" || role === "escalation")) return;
    if (role === "assignee" || can.edit || role === "coordinator" || role === "super") {
      const who = rolePerson;
      setTicket({
        ...ticket,
        staffNotes: [...ticket.staffNotes, `${who}: ${noteDraft.trim()}`],
        status: ticket.status === "Open" || ticket.status === "Unassigned" ? "In Progress" : ticket.status,
      });
      setTimeline((p) => [...p, { t: "act", text: `${who} added a note`, kind: "staff" }]);
      setNoteDraft("");
      if (stage === "accepted") setStage("working");
    }
  };

  const resolve = () => {
    if (!canResolve || !ticket) return;
    setTicket({ ...ticket, status: "Resolved" });
    setTimeline((p) => [...p, { t: "act", text: `${rolePerson} resolved ${ticket.id}`, kind: "staff" }]);
    setStage("closed");
    wakeSpotlight("status-badge");
  };

  const simulateMiss = () => {
    if (!ticket || !(role === "coordinator" || role === "manager" || role === "super")) return;
    if (stage === "closed") return;
    setTicket({ ...ticket, escalated: true, escLevel: 1, status: "Escalated" });
    setTimeline((p) => [...p, { t: "sla", text: "Response window missed · Level 1 notified · Priya Shah · 30m to act", kind: "system" }]);
    setRole("escalation");
    wakeSpotlight("esc-panel");
  };

  const escalateNext = () => {
    if (!ticket || !ticket.escalated) return;
    if (ticket.escLevel === 1 && (role === "escalation" || role === "coordinator" || role === "super")) {
      setTicket({ ...ticket, escLevel: 2, status: "Escalated" });
      setTimeline((p) => [...p, { t: "sla", text: "Level 2 notified · Ruth Allen, James Cole, Hannah Reid · 15m to act", kind: "system" }]);
      setRole("manager");
      wakeSpotlight("esc-panel");
      return;
    }
    if (ticket.escLevel === 2 && (role === "manager" || role === "coordinator" || role === "super")) {
      setTicket({ ...ticket, escLevel: 3, status: "Escalated" });
      setTimeline((p) => [...p, { t: "sla", text: "Level 3 notified · Super Admin Olivia Price · 10m to act", kind: "system" }]);
      setRole("super");
      wakeSpotlight("esc-panel");
    }
  };

  const acknowledge = () => {
    if (!ticket || !ticket.escalated) return;
    const ok =
      (ticket.escLevel === 1 && role === "escalation") ||
      (ticket.escLevel === 2 && (role === "manager" || role === "super")) ||
      (ticket.escLevel === 3 && role === "super") ||
      role === "coordinator" ||
      role === "super";
    if (!ok) return;
    const cleared = { ...ticket, escalated: false, escLevel: 0 as EscLevel, ackBy: rolePerson, status: "In Progress" };
    const routed = applyRoute(cleared, sessionAvail, cleared.declined);
    const from = ticket.primary || "Unassigned";
    setTimeline((p) => [
      ...p,
      {
        t: "act",
        text: routed.primary
          ? `${rolePerson} acknowledged · reassigned to ${routed.primary}`
          : `${rolePerson} acknowledged · still Unassigned — no ${ticket.category} staff free`,
        kind: "staff",
      },
    ]);
    if (stageIndex < STAGE_ORDER.indexOf("working")) setStage("working");
    else if (stage === "queued" || stage === "accepted") setStage("working");
    showReassign(from, routed.primary, "escalation acknowledged", { ...routed, status: routed.primary ? "In Progress" : "Unassigned" });
  };

  const canSeeTicketAsRole = () => {
    if (!ticket) return false;
    if (role === "escalation") return ticket.escalated || ticket.escLevel > 0;
    return true;
  };

  const tip = tipFor(stage, ticket, activeSpot, !!ticket?.escalated);
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const tipLeft = Math.min(Math.max(12, hole.left), Math.max(12, vw - 312));
  const tipTop = tipAbove ? Math.max(8, hole.top - 108) : Math.min(hole.top + hole.height + 12, vh - 120);

  const dismissSpot = () => setSpotlightOn(false);

  const spotlightLayer = spotlightOn && (
    <div className="walk-spotlight" aria-label="Walkthrough spotlight">
      <div className="walk-spot-shade walk-spot-top walk-spot-hit" style={{ height: Math.max(0, hole.top) }} onClick={dismissSpot} />
      <div className="walk-spot-shade walk-spot-left walk-spot-hit" style={{ top: hole.top, height: hole.height, width: Math.max(0, hole.left) }} onClick={dismissSpot} />
      <div
        className="walk-spot-shade walk-spot-right walk-spot-hit"
        style={{ top: hole.top, height: hole.height, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width) }}
        onClick={dismissSpot}
      />
      <div className="walk-spot-shade walk-spot-bottom walk-spot-hit" style={{ top: hole.top + hole.height, height: Math.max(0, vh - hole.top - hole.height) }} onClick={dismissSpot} />
      <div className="walk-spot-hole" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
      <div
        className={`walk-spot-tip ${tipAbove ? "above" : "below"}`}
        style={{ top: tipTop, left: tipLeft }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <strong>{tip.title}</strong>
        <span>{tip.body}</span>
        {canManualNext && (
          <button type="button" className="button primary" onClick={goNextStage}>
            Go to next stage
          </button>
        )}
      </div>
    </div>
  );

  if (stage === "raise" && !ticket) {
    return (
      <div className="page-content walk">
        {spotlightLayer}
        <section className="panel walk-start" data-walk-spot="raise-form">
          <header className="panel-header">
            <div>
              <div className="panel-title">Raise an issue</div>
              <div className="panel-subtitle">Submit once. Advance each stage yourself. Switch roles until it closes.</div>
            </div>
            <Badge tone="blue">Start here</Badge>
          </header>
          <div className="walk-form">
            <label>
              <span>Tenant</span>
              <input className="ent-input" value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
              <small>Property stays The Foundry · 4B · L-10482 so routing rules stay real</small>
            </label>
            <label>
              <span>Channel</span>
              <select className="ent-input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option>Inbound call</option>
                <option>Portal</option>
                <option>Email</option>
              </select>
            </label>
            <label>
              <span>Category</span>
              <select className="ent-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="walk-wide">
              <span>Issue notes</span>
              <textarea className="walk-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            </label>
            <div className="walk-form-actions">
              <button type="button" className="button primary" onClick={raiseIssue}>
                Raise issue
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!ticket) return null;

  const showEscBlocked = role === "escalation" && !canSeeTicketAsRole();
  const showStaff = !showEscBlocked && stageIndex >= STAGE_ORDER.indexOf("queued");
  const escLv = (ticket.escLevel || 1) as 1 | 2 | 3;

  return (
    <div className="page-content walk">
      {spotlightLayer}

      <section className="panel walk-sticky">
        <div className="walk-sticky-top">
          <div>
            <div className="ticket-kicker">{ticket.id} · {ticket.channel}</div>
            <strong className="walk-sticky-title">{ticket.category} — {ticket.property} {ticket.unit}</strong>
            <span className="walk-sticky-sub">
              {ticket.tenant} · Primary {ticket.primary || "Unassigned"} · Stage {STAGES[stageIndex].label}
            </span>
          </div>
          <div className="walk-sticky-meta" data-walk-spot="status-badge">
            <Badge tone={ticket.status === "Resolved" ? "green" : ticket.status === "Escalated" || ticket.status === "Unassigned" ? "red" : "blue"}>
              {ticket.status}
            </Badge>
            <Badge tone={ticket.priority === "Urgent" ? "red" : "slate"}>{ticket.priority}</Badge>
            <Badge tone={ticket.sentiment === "Negative" ? "red" : "slate"}>{ticket.sentiment}</Badge>
            <button type="button" className="button" onClick={reset}>
              Start over
            </button>
          </div>
        </div>

        <div className="walk-roles" role="tablist" aria-label="Walkthrough role" data-walk-spot="role-strip">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              className={`walk-role ${role === r.id ? "active" : ""}`}
              onClick={() => setRole(r.id)}
            >
              <strong>{r.label}</strong>
              <span>{r.id === "assignee" ? assigneeName : r.person}</span>
            </button>
          ))}
        </div>
        <div className="walk-callout">
          <strong>Acting as {role === "assignee" ? assigneeName : rolePerson}</strong>
          <span>{roleInvolved}</span>
        </div>
        {canManualNext && (
          <div className="walk-next-bar" data-walk-spot="next-btn">
            <span>Stages do not advance on their own.</span>
            <button type="button" className="button primary" onClick={goNextStage}>
              Go to next stage
            </button>
          </div>
        )}
        {stageIndex >= STAGE_ORDER.indexOf("routed") && (
          <OwnershipBoard
            ticket={ticket}
            stage={stage}
            handoff={handoff}
            track={buildTrack(ticket)}
          />
        )}
      </section>

      <div className="walk-layout">
        <aside className="panel walk-rail" aria-label="Walkthrough stages">
          <div className="panel-header">
            <div>
              <div className="panel-title">Path</div>
              <div className="panel-subtitle">Use Go to next stage until the queue</div>
            </div>
          </div>
          <ol className="walk-stages">
            {STAGES.map((s, i) => {
              const done = i < stageIndex || (stage === "closed" && s.id === "closed");
              const current = s.id === stage;
              const locked = i > stageIndex;
              return (
                <li key={s.id} className={`${current ? "current" : ""} ${done ? "done" : ""} ${locked ? "locked" : ""}`}>
                  <button type="button" disabled={locked}>
                    <i>{done ? "✓" : i + 1}</i>
                    <span>{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="walk-timeline">
            <small>What just ran</small>
            {timeline.map((e, i) => (
              <div key={i} className={`walk-tl walk-tl-${e.kind}`}>
                <b>{e.t}</b>
                <span>{e.text}</span>
              </div>
            ))}
          </div>
        </aside>

        <div className="walk-main">
          {stageIndex < STAGE_ORDER.indexOf("accepted") && (
            <section className="panel walk-convert">
              <header className="panel-header">
                <div>
                  <div className="panel-title">Issue converted to ticket</div>
                  <div className="panel-subtitle">Advance enrichment and routing with Go to next stage</div>
                </div>
                <Badge tone="teal">Live</Badge>
              </header>
              <div className="walk-ticket-card" data-walk-spot="ticket-card">
                <div className="walk-ticket-id">{ticket.id}</div>
                <p>{ticket.notes}</p>
                <div className="walk-ticket-tags" data-walk-spot="ai-tags">
                  <Badge tone="slate">{ticket.category}</Badge>
                  {stageIndex >= STAGE_ORDER.indexOf("enriched") && (
                    <>
                      <Badge tone="purple">AI {ticket.confidence}%</Badge>
                      <Badge tone={ticket.priority === "Urgent" ? "red" : "slate"}>{ticket.priority}</Badge>
                      <Badge tone={ticket.sentiment === "Negative" ? "red" : "slate"}>{ticket.sentiment}</Badge>
                      {ticket.urgencyTags.map((t) => (
                        <Badge key={t} tone="amber">{t}</Badge>
                      ))}
                    </>
                  )}
                  {stageIndex >= STAGE_ORDER.indexOf("routed") && (
                    <Badge tone={ticket.primary ? "teal" : "red"}>{ticket.primary ? `→ ${ticket.primary}` : "Unassigned"}</Badge>
                  )}
                </div>
                {stageIndex >= STAGE_ORDER.indexOf("routed") && (
                  <div className="walk-route-line walk-route-line-slim" data-walk-spot="route-block">
                    <span><small>Manager</small><strong>{ticket.manager}</strong></span>
                    <span><small>Respond / resolve</small><strong>{fmtMins(ticket.responseMins)} / {fmtMins(ticket.resolveMins)}</strong></span>
                    {ticket.backup && ticket.backup !== "—" && (
                      <span><small>Backup</small><strong>{ticket.backup}</strong></span>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {showEscBlocked && (
            <section className="panel walk-blocked">
              <strong>Not on this ticket yet</strong>
              <p>Open Simulate SLA miss as Coordinator when the skill pool is empty or the response window is missed.</p>
            </section>
          )}

          {ticket.escalated && (
            <section className="panel walk-esc-panel" data-walk-spot="esc-panel">
              <header className="panel-header">
                <div>
                  <div className="panel-title">Escalation in progress</div>
                  <div className="panel-subtitle">Advance notifies the next level only — it never resolves the ticket</div>
                </div>
                <Badge tone="red">Level {ticket.escLevel} · Waiting</Badge>
              </header>
              <div className="walk-esc-body">
                <div className="walk-esc-levels">
                  {([1, 2, 3] as const).map((lv) => (
                    <div key={lv} className={`walk-esc-level ${ticket.escLevel === lv ? "active" : ""} ${ticket.escLevel > lv ? "done" : ""}`}>
                      <b>{lv}</b>
                      <span>
                        <strong>{ESC_META[lv].who}</strong>
                        <small>Act within {ESC_META[lv].mins}m · {ticket.escLevel > lv ? "Passed" : ticket.escLevel === lv ? "Waiting" : "Pending"}</small>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="walk-muted">Notified now: {ESC_META[escLv].who}. Acting as {rolePerson}.</p>
                <div className="walk-actions" style={{ borderTop: 0, padding: "4px 0 0" }}>
                  {ticket.escLevel < 3 && (role === "escalation" || role === "manager" || role === "coordinator" || role === "super") && (
                    <button type="button" className="button" onClick={escalateNext}>
                      Advance escalation
                    </button>
                  )}
                  <button type="button" className="button primary" onClick={acknowledge}>
                    Acknowledge · return to skill pool
                  </button>
                </div>
              </div>
            </section>
          )}

          {showStaff && (
            <>
              {role === "tenant" && (
                <section className="panel">
                  <header className="panel-header">
                    <div>
                      <div className="panel-title">Your request</div>
                      <div className="panel-subtitle">Tenant portal view</div>
                    </div>
                    <Badge tone="blue">{ticket.status}</Badge>
                  </header>
                  <div className="walk-body">
                    <p>{ticket.notes}</p>
                    <div className="walk-kv">
                      <span><small>Ticket</small><strong>{ticket.id}</strong></span>
                      <span><small>Property</small><strong>{ticket.property} · {ticket.unit}</strong></span>
                      <span><small>Category</small><strong>{ticket.category}</strong></span>
                      <span><small>Status</small><strong>{ticket.status}</strong></span>
                    </div>
                  </div>
                </section>
              )}

              {role !== "tenant" && (
                <section className="panel">
                  <header className="panel-header">
                    <div>
                      <div className="panel-title">{role === "assignee" ? "My queue" : "Ticket queue"}</div>
                      <div className="panel-subtitle">Live walkthrough ticket for {role === "assignee" ? assigneeName : rolePerson}</div>
                    </div>
                  </header>
                  <div className="walk-queue-row" data-walk-spot="queue-row">
                    <strong className="ticket-id">{ticket.id}</strong>
                    <span>{ticket.tenant}<small>{ticket.property}</small></span>
                    <span>{ticket.category}</span>
                    <Badge tone={ticket.priority === "Urgent" ? "red" : "slate"}>{ticket.priority}</Badge>
                    <Badge tone={ticket.sentiment === "Negative" ? "red" : "slate"}>{ticket.sentiment}</Badge>
                    <span>{ticket.primary || "Unassigned"}</span>
                    <strong>{fmtMins(ticket.responseMins)}</strong>
                    <Badge tone={ticket.status === "Resolved" ? "green" : ticket.status === "Escalated" || ticket.status === "Unassigned" ? "red" : "blue"}>
                      {ticket.status}
                    </Badge>
                  </div>
                </section>
              )}

              {role !== "tenant" && (
                <section className="panel">
                  <header className="panel-header">
                    <div>
                      <div className="panel-title">Ticket detail</div>
                      <div className="panel-subtitle">{ticket.id} · {ticket.primary || "Unassigned"}</div>
                    </div>
                    {role === "super" && <Badge tone="purple">See everything</Badge>}
                  </header>
                  <div className="walk-detail">
                    <div className="walk-detail-main">
                      <p>{ticket.notes}</p>
                      <div className="walk-ticket-tags">
                        {ticket.urgencyTags.map((t) => (
                          <Badge key={t} tone="amber">{t}</Badge>
                        ))}
                      </div>
                      {ticket.staffNotes.length > 0 && (
                        <div className="walk-notes">
                          <small>Staff notes</small>
                          {ticket.staffNotes.map((n, i) => (
                            <div key={i}>{n}</div>
                          ))}
                        </div>
                      )}
                      {stage !== "closed" && !ticket.escalated && (role === "assignee" || can.edit || role === "coordinator" || role === "super") && (
                        <div className="walk-note-box">
                          <textarea
                            className="walk-textarea"
                            rows={2}
                            placeholder="Add an internal note…"
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                          />
                          <button type="button" className="button primary" onClick={addNote}>
                            Add note
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="walk-detail-side">
                      <div className="walk-meta" data-walk-spot="sla-panel">
                        <div className="walk-sla">
                          <small>SLA respond / resolve</small>
                          <strong>{fmtMins(ticket.responseMins)} / {fmtMins(ticket.resolveMins)}</strong>
                          <span>{ticket.priority} × category policy</span>
                        </div>
                        <div className="walk-meta-row" data-walk-spot="route-block">
                          <span><small>Manager</small><strong>{ticket.manager}</strong></span>
                          <span><small>AI</small><strong>{ticket.confidence}% · {ticket.sentimentScore}</strong></span>
                          {ticket.backup && ticket.backup !== "—" && (
                            <span><small>Backup</small><strong>{ticket.backup}</strong></span>
                          )}
                        </div>
                      </div>
                      {!ticket.primary && !ticket.escalated && (
                        <div className="walk-esc">
                          <Badge tone="amber">No skilled staff free</Badge>
                          <p>Ownership is empty — open escalation from Actions.</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {!ticket.escalated && (
                    <div className="walk-actions" data-walk-spot="actions">
                      {stage === "queued" && role === "assignee" && ticket.primary && (
                        <>
                          <button type="button" className="button primary" onClick={accept}>
                            Accept assignment
                          </button>
                          <button type="button" className="button danger" onClick={decline}>
                            Decline ticket
                          </button>
                          <button type="button" className="button" onClick={markBusy}>
                            I’m busy / Unavailable
                          </button>
                        </>
                      )}
                      {stage === "queued" && role === "assignee" && !ticket.primary && (
                        <span className="walk-hint">No assignee. Switch to Coordinator to open escalation.</span>
                      )}
                      {stage === "queued" && role !== "assignee" && ticket.primary && (
                        <span className="walk-hint">Switch to Assignee ({ticket.primary}) to accept, decline, or mark busy</span>
                      )}
                      {(stage === "queued" || stage === "routed") && (role === "coordinator" || role === "super") && ticket.primary && (
                        <button type="button" className="button" onClick={markBusy}>
                          Mark assignee busy
                        </button>
                      )}
                      {canResolve && (
                        <button type="button" className="button primary" onClick={resolve}>
                          Resolve
                        </button>
                      )}
                      {(stage === "accepted" || stage === "working") && !canResolve && (
                        <span className="walk-hint">
                          {ticket.escalated
                            ? "Escalation open — acknowledge before resolve"
                            : !ticket.primary
                              ? "Resolve locked until a primary is assigned"
                              : "Switch to Assignee or Coordinator to resolve"}
                        </span>
                      )}
                      {stage !== "closed" && (role === "coordinator" || role === "manager" || role === "super") && !ticket.escalated && (
                        <button type="button" className="button danger" onClick={simulateMiss}>
                          Open escalation (SLA miss)
                        </button>
                      )}
                      {stage === "closed" && <Badge tone="green">Resolved · {ticket.primary}</Badge>}
                    </div>
                  )}
                </section>
              )}

              {role === "tenant" && stage === "closed" && (
                <section className="panel">
                  <div className="walk-body">
                    <Badge tone="green">Resolved</Badge>
                    <p>Your issue {ticket.id} was closed{ticket.primary ? ` by ${ticket.primary}` : ""}.</p>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
