"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Tone = "blue" | "green" | "amber" | "red" | "purple" | "teal" | "slate";
type Availability = "Available" | "On call" | "Unavailable";
type Mode = "sequential" | "parallel";
type Priority = "Urgent" | "High" | "Normal" | "Low";

export type Category = { id: string; name: string; responseMins: number; resolveMins: number };
export type Role = { id: string; name: string; desc: string; kind: "system" | "tier"; locked?: boolean };
export type User = { id: string; name: string; email: string; roleId: string; skills: string[]; availability: Availability; open: number };
export type Level = { id: string; to: string[]; mode: Mode; ackMins: number };

const PERMS = [
  ["view", "View tickets"],
  ["create", "Create tickets"],
  ["edit", "Edit tickets"],
  ["delete", "Delete tickets"],
  ["reassign", "Reassign tickets"],
  ["config", "Configure SLA & routing"],
  ["users", "Manage users"],
  ["billing", "Licensing & billing"],
] as const;

type PermMatrix = Record<string, Record<string, boolean>>;
const PRIORITIES: Priority[] = ["Urgent", "High", "Normal", "Low"];

type License = { plan: string; seats: number; pricePerSeat: number; expires: string };

type Ctx = {
  categories: Category[]; setCategories: Dispatch<SetStateAction<Category[]>>;
  roles: Role[]; setRoles: Dispatch<SetStateAction<Role[]>>;
  perms: PermMatrix; setPerms: Dispatch<SetStateAction<PermMatrix>>;
  users: User[]; setUsers: Dispatch<SetStateAction<User[]>>;
  chains: Record<string, Level[]>; setChains: Dispatch<SetStateAction<Record<string, Level[]>>>;
  multipliers: Record<Priority, number>; setMultipliers: Dispatch<SetStateAction<Record<Priority, number>>>;
  license: License; setSeats: (n: number) => void;
};

const EnterpriseCtx = createContext<Ctx | null>(null);

export function useEnterprise() {
  const c = useContext(EnterpriseCtx);
  if (!c) throw new Error("EnterpriseProvider is missing");
  return c;
}

/* ------------------------------------------------------------------ */
/* Seed data                                                           */
/* ------------------------------------------------------------------ */
const defaultChain = (): Level[] => [
  { id: "l1", to: ["t2"], mode: "sequential", ackMins: 30 },
  { id: "l2", to: ["t1", "regional"], mode: "parallel", ackMins: 15 },
  { id: "l3", to: ["super"], mode: "sequential", ackMins: 10 },
];

const seedCategories: Category[] = [
  { id: "heating", name: "Heating", responseMins: 60, resolveMins: 480 },
  { id: "plumbing", name: "Plumbing", responseMins: 120, resolveMins: 720 },
  { id: "electrical", name: "Electrical", responseMins: 60, resolveMins: 480 },
  { id: "access", name: "Access", responseMins: 30, resolveMins: 240 },
  { id: "lift", name: "Lift", responseMins: 30, resolveMins: 360 },
  { id: "noise", name: "Noise", responseMins: 240, resolveMins: 1440 },
  { id: "safeguarding", name: "Safeguarding", responseMins: 15, resolveMins: 120 },
];

const seedRoles: Role[] = [
  { id: "super", name: "Super Admin", desc: "One per enterprise. Configures roles, tiers, categories, SLAs and licensing.", kind: "system", locked: true },
  { id: "regional", name: "Regional Admin", desc: "Delegated admin for a region or property group. Cannot change licensing.", kind: "system" },
  { id: "t1", name: "Type 1", desc: "Senior tier. Final escalation point before admins.", kind: "tier" },
  { id: "t2", name: "Type 2", desc: "Middle tier. First escalation point for assignees.", kind: "tier" },
  { id: "t3", name: "Type 3", desc: "Front-line tier. Works assigned tickets.", kind: "tier" },
];

const P = (view: boolean, create: boolean, edit: boolean, del: boolean, reassign: boolean, config: boolean, users: boolean, billing: boolean) =>
  ({ view, create, edit, delete: del, reassign, config, users, billing });

const seedPerms: PermMatrix = {
  super: P(true, true, true, true, true, true, true, true),
  regional: P(true, true, true, true, true, true, true, false),
  t1: P(true, true, true, false, true, false, false, false),
  t2: P(true, true, true, false, true, false, false, false),
  t3: P(true, true, false, false, false, false, false, false),
};

const seedUsers: User[] = [
  { id: "u1", name: "Olivia Price", email: "olivia.price@example.com", roleId: "super", skills: [], availability: "Available", open: 0 },
  { id: "u2", name: "Hannah Reid", email: "hannah.reid@example.com", roleId: "regional", skills: [], availability: "Available", open: 0 },
  { id: "u3", name: "Ruth Allen", email: "ruth.allen@example.com", roleId: "t1", skills: [], availability: "Available", open: 1 },
  { id: "u4", name: "James Cole", email: "james.cole@example.com", roleId: "t1", skills: [], availability: "On call", open: 0 },
  { id: "u5", name: "Priya Shah", email: "priya.shah@example.com", roleId: "t2", skills: ["Access", "Noise", "Safeguarding"], availability: "On call", open: 4 },
  { id: "u6", name: "Dana Hughes", email: "dana.hughes@example.com", roleId: "t3", skills: ["Heating", "Plumbing", "Electrical"], availability: "Available", open: 6 },
  { id: "u7", name: "Marcus Lee", email: "marcus.lee@example.com", roleId: "t3", skills: ["Heating", "Electrical", "Access", "Lift"], availability: "Available", open: 8 },
  { id: "u8", name: "Alex Morgan", email: "alex.morgan@example.com", roleId: "t3", skills: ["Noise", "Safeguarding"], availability: "Unavailable", open: 2 },
];

const seedChains = (): Record<string, Level[]> => {
  const out: Record<string, Level[]> = {};
  seedCategories.forEach((c) => { out[c.id] = defaultChain(); });
  out.safeguarding = [
    { id: "l1", to: ["t2", "t1"], mode: "parallel", ackMins: 10 },
    { id: "l2", to: ["regional", "super"], mode: "parallel", ackMins: 5 },
  ];
  return out;
};

export function EnterpriseProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>(seedCategories);
  const [roles, setRoles] = useState<Role[]>(seedRoles);
  const [perms, setPerms] = useState<PermMatrix>(seedPerms);
  const [users, setUsers] = useState<User[]>(seedUsers);
  const [chains, setChains] = useState<Record<string, Level[]>>(seedChains);
  const [multipliers, setMultipliers] = useState<Record<Priority, number>>({ Urgent: 0.25, High: 0.5, Normal: 1, Low: 2 });
  const [license, setLicense] = useState<License>({ plan: "Starter", seats: 10, pricePerSeat: 12, expires: "30 Sep 2027" });
  const setSeats = (n: number) => setLicense((l) => ({ ...l, seats: n }));
  return <EnterpriseCtx.Provider value={{ categories, setCategories, roles, setRoles, perms, setPerms, users, setUsers, chains, setChains, multipliers, setMultipliers, license, setSeats }}>{children}</EnterpriseCtx.Provider>;
}

/* ------------------------------------------------------------------ */
/* Helpers + small primitives (same class names as App.tsx)            */
/* ------------------------------------------------------------------ */
const fmt = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
const initials = (n: string) => n.split(" ").map((x) => x[0]).join("").slice(0, 2);
const roleName = (roles: Role[], id: string) => roles.find((r) => r.id === id)?.name ?? id;

function Ico({ name, size = 13 }: { name: string; size?: number }) {
  const p: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    lock: <><rect x="5" y="11" width="14" height="9" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 19c0-4 2-6 6-6s6 2 6 6" /><path d="M16 5a3 3 0 0 1 0 6m1 3c3 .4 4 2 4 5" /></>,
    bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]}</svg>;
}

function Btn({ children, variant = "secondary", icon, onClick, disabled }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; icon?: string; onClick?: () => void; disabled?: boolean }) {
  return <div className={`button ${variant} ${disabled ? "disabled" : ""}`} role="button" tabIndex={0} onClick={disabled ? undefined : onClick}>{icon && <Ico name={icon} />}{children}</div>;
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
function Note({ tone = "blue", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`ent-note ent-note-${tone}`}>{children}</div>;
}
function Segmented({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return <div className="segmented ent-seg">{options.map(([id, label]) => <span key={id} role="button" className={id === value ? "active" : ""} onClick={() => onChange(id)}>{label}</span>)}</div>;
}
function Toggle({ on, locked, onClick }: { on: boolean; locked?: boolean; onClick?: () => void }) {
  return <span className={`ent-check ${on ? "on" : ""} ${locked ? "locked" : ""}`} role="checkbox" aria-checked={on} onClick={locked ? undefined : onClick}>{on && <Ico name="check" size={11} />}</span>;
}
function Chip({ on, children, onClick, locked }: { on: boolean; children: ReactNode; onClick?: () => void; locked?: boolean }) {
  return <span className={`ent-chip ${on ? "on" : ""} ${locked ? "locked" : ""}`} role="button" onClick={locked ? undefined : onClick}>{on && <Ico name="check" size={10} />}{children}</span>;
}

export function EntTabs({ tabs, value, onChange }: { tabs: [string, string, string?][]; value: string; onChange: (v: string) => void }) {
  return <div className="ent-tabs">{tabs.map(([id, label, count]) => <span key={id} role="button" className={id === value ? "active" : ""} onClick={() => onChange(id)}>{label}{count && <b>{count}</b>}</span>)}</div>;
}

/* ------------------------------------------------------------------ */
/* Administration                                                      */
/* ------------------------------------------------------------------ */
type AdminTab = "roles" | "users" | "categories" | "licensing";

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("roles");
  const { users, categories, license } = useEnterprise();
  return <div className="page-content">
    <EntTabs value={tab} onChange={(v) => setTab(v as AdminTab)} tabs={[
      ["roles", "Roles & permissions"],
      ["users", "Users & skills", `${users.length}/${license.seats}`],
      ["categories", "Categories & skills", String(categories.length)],
      ["licensing", "Licensing"],
    ]} />
    {tab === "roles" && <RolesTab />}
    {tab === "users" && <UsersTab />}
    {tab === "categories" && <CategoriesTab />}
    {tab === "licensing" && <LicensingTab />}
  </div>;
}

function RolesTab() {
  const { roles, setRoles, perms, setPerms, users, chains } = useEnterprise();
  const tierCount = roles.filter((r) => r.kind === "tier").length;
  const addTier = () => {
    const id = `tier-${Date.now()}`;
    setRoles((p) => [...p, { id, name: `Type ${tierCount + 1}`, desc: "New tier. Rename it and grant permissions below.", kind: "tier" }]);
    setPerms((p) => ({ ...p, [id]: P(true, false, false, false, false, false, false, false) }));
  };
  const rename = (id: string, name: string) => setRoles((p) => p.map((r) => (r.id === id ? { ...r, name } : r)));
  const inChain = (id: string) => Object.values(chains).some((lv) => lv.some((l) => l.to.includes(id)));
  const remove = (id: string) => {
    setRoles((p) => p.filter((r) => r.id !== id));
    setPerms((p) => { const n = { ...p }; delete n[id]; return n; });
  };
  const toggle = (rid: string, key: string) => setPerms((p) => ({ ...p, [rid]: { ...p[rid], [key]: !p[rid]?.[key] } }));
  const cols = `1.5fr repeat(${PERMS.length}, 1fr)`;

  return <>
    <Note tone="blue"><strong>Roles are generic tiers, not job titles.</strong> The Super Admin (one per enterprise) decides how many tiers exist, what they are called and what each can do. Edit and delete are off until explicitly granted.</Note>
    <Panel className="ent-gap">
      <PanelHeader title="Hierarchy" subtitle="Highest authority first. Escalations move up this order." action={<Btn variant="primary" icon="plus" onClick={addTier}>Add tier</Btn>} />
      <div className="ent-rows">
        <div className="ent-row head" style={{ gridTemplateColumns: "28px 1.1fr 2.4fr .5fr 70px" }}><span>#</span><span>Role name</span><span>Description</span><span>Members</span><span /></div>
        {roles.map((r, i) => {
          const members = users.filter((u) => u.roleId === r.id).length;
          const blocked = members > 0 || inChain(r.id);
          return <div className="ent-row" key={r.id} style={{ gridTemplateColumns: "28px 1.1fr 2.4fr .5fr 70px" }}>
            <span className="ent-level">{i + 1}</span>
            <span>{r.kind === "tier" ? <input className="ent-input" value={r.name} onChange={(e) => rename(r.id, e.target.value)} aria-label="Role name" /> : <strong className="ent-locked-name">{r.locked && <Ico name="lock" size={11} />}{r.name}</strong>}</span>
            <span className="ent-muted">{r.desc}</span>
            <span>{r.id === "super" ? <Badge tone="purple">{members} / 1</Badge> : <strong>{members}</strong>}</span>
            <span>{r.kind === "tier" && <span className={`text-link ${blocked ? "disabled-link" : ""}`} title={blocked ? "In use by members or an escalation chain" : "Remove tier"} role="button" onClick={blocked ? undefined : () => remove(r.id)}>Remove</span>}</span>
          </div>;
        })}
      </div>
    </Panel>
    <Panel className="ent-gap">
      <PanelHeader title="Permissions" subtitle="Tick to grant. The Super Admin row is fixed." action={<Badge tone="amber">Edit / delete need explicit access</Badge>} />
      <div className="ent-rows">
        <div className="ent-row head" style={{ gridTemplateColumns: cols }}><span>Role</span>{PERMS.map((p) => <span key={p[0]} className="ent-center">{p[1]}</span>)}</div>
        {roles.map((r) => <div className="ent-row" key={r.id} style={{ gridTemplateColumns: cols }}>
          <strong>{r.name}</strong>
          {PERMS.map((p) => <span key={p[0]} className="ent-center"><Toggle on={!!perms[r.id]?.[p[0]]} locked={r.locked} onClick={() => toggle(r.id, p[0])} /></span>)}
        </div>)}
      </div>
    </Panel>
  </>;
}

function UsersTab() {
  const { users, setUsers, roles, categories, license } = useEnterprise();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("t3");
  const [skills, setSkills] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);
  const used = users.length;
  const full = used >= license.seats;
  const role = roles.find((r) => r.id === roleId);

  const invite = () => {
    if (full) return setMsg({ tone: "red", text: `Seat limit reached (${used}/${license.seats}). Add seats under Licensing to invite more people.` });
    if (!name.trim() || !email.trim()) return setMsg({ tone: "amber", text: "Name and email are required." });
    if (role?.kind === "tier" && skills.length === 0) return setMsg({ tone: "amber", text: "Select at least one skill so tickets can be routed to this person." });
    setUsers((p) => [...p, { id: `u-${Date.now()}`, name: name.trim(), email: email.trim(), roleId, skills: role?.kind === "tier" ? skills : [], availability: "Available", open: 0 }]);
    setMsg({ tone: "green", text: `${name.trim()} invited as ${role?.name}. They now use 1 seat.` });
    setName(""); setEmail(""); setSkills([]);
  };
  const toggleSkill = (s: string) => setSkills((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  const removeUser = (id: string) => setUsers((p) => p.filter((u) => u.id !== id));
  const avTone = (a: Availability): Tone => (a === "Available" ? "green" : a === "On call" ? "amber" : "slate");

  return <div className="ent-two ent-two-wide-left">
    <Panel>
      <PanelHeader title="Team members" subtitle={`${used} of ${license.seats} licensed seats in use`} action={<Badge tone={full ? "red" : "blue"}>{full ? "No seats left" : `${license.seats - used} seats free`}</Badge>} />
      <div className="ent-rows">
        <div className="ent-row head" style={{ gridTemplateColumns: "1.5fr .8fr 2fr .8fr 50px" }}><span>User</span><span>Role</span><span>Skills</span><span>Availability</span><span /></div>
        {users.map((u) => <div className="ent-row tall" key={u.id} style={{ gridTemplateColumns: "1.5fr .8fr 2fr .8fr 50px" }}>
          <span className="ent-user"><i className="avatar-small">{initials(u.name)}</i><span><strong>{u.name}</strong><small>{u.email}</small></span></span>
          <span><Badge tone={u.roleId === "super" ? "purple" : u.roleId === "regional" ? "blue" : "slate"}>{roleName(roles, u.roleId)}</Badge></span>
          <span className="ent-chips">{u.skills.length ? u.skills.map((s) => <Badge key={s} tone="teal">{s}</Badge>) : <span className="ent-muted">No ticket skills (admin / oversight)</span>}</span>
          <span><Badge tone={avTone(u.availability)} dot>{u.availability}</Badge></span>
          <span>{u.roleId !== "super" && <span className="text-link" role="button" onClick={() => removeUser(u.id)}>Remove</span>}</span>
        </div>)}
      </div>
    </Panel>
    <Panel>
      <PanelHeader title="Onboard a team member" subtitle="Uses one licensed seat" />
      <div className="ent-form">
        <label><span>Full name</span><input className="ent-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Carter" /></label>
        <label><span>Work email</span><input className="ent-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam.carter@company.com" /></label>
        <label><span>Role</span>
          <select className="ent-input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.filter((r) => r.id !== "super").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        {role?.kind === "tier" && <div className="ent-skillpick">
          <span>Skills / specialisms</span>
          <div className="ent-chips">{categories.map((c) => <Chip key={c.id} on={skills.includes(c.name)} onClick={() => toggleSkill(c.name)}>{c.name}</Chip>)}</div>
          <small>Tickets in these categories are prioritised to this person.</small>
        </div>}
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        <Btn variant="primary" icon="plus" onClick={invite}>Send invite</Btn>
      </div>
    </Panel>
  </div>;
}

function CategoriesTab() {
  const { categories, setCategories, setChains, users } = useEnterprise();
  const [val, setVal] = useState("");
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);
  const add = () => {
    const n = val.trim();
    if (!n) return;
    if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) return setMsg({ tone: "red", text: `"${n}" already exists in this enterprise. Names must be unique within an enterprise.` });
    const id = `c-${Date.now()}`;
    setCategories((p) => [...p, { id, name: n, responseMins: 60, resolveMins: 480 }]);
    setChains((p) => ({ ...p, [id]: defaultChain() }));
    setVal("");
    setMsg({ tone: "green", text: `Category "${n}" added. A matching skill is now available when onboarding staff, and default SLA + escalation chain were created.` });
  };
  return <>
    <Note tone="blue"><strong>Skills mirror categories.</strong> Every category is also a skill. Names are unique inside an enterprise; another enterprise can reuse the same names. Only admins can add categories.</Note>
    <Panel className="ent-gap">
      <PanelHeader title="Ticket categories & skills" subtitle="Set response and resolution times under SLA & Escalations" />
      <div className="ent-addbar">
        <input className="ent-input" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="New category name, e.g. Pest control" />
        <Btn variant="primary" icon="plus" onClick={add}>Add category</Btn>
      </div>
      {msg && <div className="ent-addmsg"><Note tone={msg.tone}>{msg.text}</Note></div>}
      <div className="ent-rows">
        <div className="ent-row head" style={{ gridTemplateColumns: "1.2fr 1.2fr 1.6fr 1fr" }}><span>Category</span><span>Linked skill</span><span>Qualified staff</span><span>Coverage</span></div>
        {categories.map((c) => {
          const staff = users.filter((u) => u.skills.includes(c.name));
          return <div className="ent-row" key={c.id} style={{ gridTemplateColumns: "1.2fr 1.2fr 1.6fr 1fr" }}>
            <strong>{c.name}</strong>
            <span><Badge tone="teal">{c.name}</Badge></span>
            <span className="ent-muted">{staff.length ? staff.map((s) => s.name).join(", ") : "Nobody yet"}</span>
            <span><Badge tone={staff.length === 0 ? "red" : staff.length === 1 ? "amber" : "green"}>{staff.length === 0 ? "No cover" : staff.length === 1 ? "Single point of failure" : `${staff.length} people`}</Badge></span>
          </div>;
        })}
      </div>
    </Panel>
  </>;
}

function LicensingTab() {
  const { users, license, setSeats } = useEnterprise();
  const used = users.length;
  const pct = Math.min(100, Math.round((used / license.seats) * 100));
  const monthly = license.seats * license.pricePerSeat;
  const plans = [
    ["Starter", "up to 10", "Up to 3 tiers, category SLAs, sequential escalation", "Small teams"],
    ["Business", "up to 50", "Unlimited tiers, Regional Admins, skill routing, parallel escalation, reports", "Mid-size operators"],
    ["Enterprise", "50+ (custom)", "Multiple regions, data migration, custom SLA rules, priority support", "Large portfolios"],
  ];
  return <>
    <div className="ent-cards">
      <Panel className="ent-card"><small>PLAN</small><strong>{license.plan}</strong><span>Billed per seat · ${license.pricePerSeat}/seat/month <Badge tone="amber">placeholder price</Badge></span></Panel>
      <Panel className="ent-card"><small>SEATS</small><strong>{used} <em>/ {license.seats}</em></strong><div className="ent-bar"><i className={pct >= 100 ? "full" : ""} style={{ width: `${pct}%` }} /></div><span>${monthly}/month at current seat count</span></Panel>
      <Panel className="ent-card"><small>EXPIRES</small><strong>{license.expires}</strong><span>About 11 months left · 7-day grace period, then read-only</span></Panel>
    </div>
    <Panel className="ent-gap">
      <PanelHeader title="Seat management" subtitle="Seats are per internal team member using the product" action={<div className="ent-actions"><Btn onClick={() => setSeats(license.seats + 5)}>Add 5 seats</Btn><Btn disabled={license.seats - 5 < used} onClick={() => setSeats(license.seats - 5)}>Remove 5 seats</Btn></div>} />
      <div className="ent-rows">
        <div className="ent-row"><span>Invites are blocked when every seat is taken. Removing a user frees their seat immediately.</span></div>
        <div className="ent-row"><span>Expired licenses keep all data and become read-only after the grace period. Nothing is deleted.</span></div>
      </div>
    </Panel>
    <Panel className="ent-gap">
      <PanelHeader title="Plans" subtitle="Draft structure for discussion. Seat counts and gating are editable later." />
      <div className="ent-rows">
        <div className="ent-row head" style={{ gridTemplateColumns: ".8fr .8fr 3fr 1fr" }}><span>Plan</span><span>Seats</span><span>Includes</span><span>Good for</span></div>
        {plans.map((p) => <div className="ent-row tall" key={p[0]} style={{ gridTemplateColumns: ".8fr .8fr 3fr 1fr" }}><span><strong>{p[0]}</strong> {p[0] === license.plan && <Badge tone="blue">Current</Badge>}</span><span>{p[1]}</span><span className="ent-muted">{p[2]}</span><span>{p[3]}</span></div>)}
      </div>
    </Panel>
    <div className="migration-steps ent-gap">
      <span className="done"><i><Ico name="check" /></i>Create enterprise</span><b />
      <span className="done"><i><Ico name="check" /></i>Assign Super Admin</span><b />
      <span className="done"><i><Ico name="check" /></i>Set seats & expiry</span><b />
      <span className="active"><i>4</i>Configure roles & categories</span><b />
      <span><i>5</i>Invite team</span>
    </div>
  </>;
}

/* ------------------------------------------------------------------ */
/* SLA policies                                                        */
/* ------------------------------------------------------------------ */
export function SlaPolicies() {
  const { categories, setCategories, multipliers, setMultipliers } = useEnterprise();
  const upd = (id: string, key: "responseMins" | "resolveMins", raw: string) => {
    const v = parseInt(raw, 10);
    setCategories((p) => p.map((c) => (c.id === id ? { ...c, [key]: Number.isNaN(v) ? 0 : Math.max(0, v) } : c)));
  };
  return <>
    <Panel>
      <PanelHeader title="Response & resolution times by category" subtitle="Minimum commitments. A breach starts the escalation chain." action={<Badge tone="blue">Set per category</Badge>} />
      <div className="ent-rows">
        <div className="ent-row head" style={{ gridTemplateColumns: "1.2fr 1fr 1fr 1fr" }}><span>Category</span><span>Respond within (min)</span><span>Resolve within (min)</span><span>Readable</span></div>
        {categories.map((c) => {
          const bad = c.resolveMins <= c.responseMins;
          return <div className="ent-row" key={c.id} style={{ gridTemplateColumns: "1.2fr 1fr 1fr 1fr" }}>
            <strong>{c.name}</strong>
            <span><input className="ent-num" type="number" min={0} value={c.responseMins} onChange={(e) => upd(c.id, "responseMins", e.target.value)} /></span>
            <span><input className="ent-num" type="number" min={0} value={c.resolveMins} onChange={(e) => upd(c.id, "resolveMins", e.target.value)} /></span>
            <span>{bad ? <Badge tone="red">Resolution must exceed response</Badge> : <span className="ent-muted">{fmt(c.responseMins)} / {fmt(c.resolveMins)}</span>}</span>
          </div>;
        })}
      </div>
    </Panel>
    <Panel className="ent-gap">
      <PanelHeader title="Priority overrides" subtitle="Each ticket priority scales the category times. Effective times shown below." />
      <div className="ent-mult">
        {PRIORITIES.map((p) => <label key={p}><span>{p}</span><div><small>×</small><input className="ent-num" type="number" step="0.05" min={0.05} value={multipliers[p]} onChange={(e) => setMultipliers((m) => ({ ...m, [p]: Math.max(0.05, parseFloat(e.target.value) || 0.05) }))} /></div></label>)}
      </div>
      <div className="ent-rows">
        <div className="ent-row head" style={{ gridTemplateColumns: `1.2fr repeat(${PRIORITIES.length}, 1fr)` }}><span>Effective response / resolution</span>{PRIORITIES.map((p) => <span key={p}>{p}</span>)}</div>
        {categories.map((c) => <div className="ent-row" key={c.id} style={{ gridTemplateColumns: `1.2fr repeat(${PRIORITIES.length}, 1fr)` }}>
          <strong>{c.name}</strong>
          {PRIORITIES.map((p) => <span key={p}>{fmt(Math.max(1, Math.round(c.responseMins * multipliers[p])))} <span className="ent-muted">/ {fmt(Math.max(1, Math.round(c.resolveMins * multipliers[p])))}</span></span>)}
        </div>)}
      </div>
    </Panel>
  </>;
}

/* ------------------------------------------------------------------ */
/* Escalation chain builder                                            */
/* ------------------------------------------------------------------ */
export function EscalationBuilder() {
  const { categories, roles, chains, setChains, multipliers } = useEnterprise();
  const [catId, setCatId] = useState(categories[0].id);
  const [prio, setPrio] = useState<Priority>("Normal");
  const [urgentParallel, setUrgentParallel] = useState(true);
  const cat = categories.find((c) => c.id === catId) ?? categories[0];
  const levels = chains[cat.id] ?? [];
  const lowToHigh = [...roles].reverse();

  const setLevels = (fn: (l: Level[]) => Level[]) => setChains((p) => ({ ...p, [cat.id]: fn(p[cat.id] ?? []) }));
  const patch = (id: string, change: Partial<Level>) => setLevels((l) => l.map((x) => (x.id === id ? { ...x, ...change } : x)));
  const toggleRole = (lv: Level, rid: string) => {
    const has = lv.to.includes(rid);
    if (has && lv.to.length === 1) return;
    const next = has ? lv.to.filter((x) => x !== rid) : [...lv.to, rid];
    patch(lv.id, { to: lowToHigh.map((r) => r.id).filter((id) => next.includes(id)) });
  };
  const addLevel = () => setLevels((l) => [...l, { id: `l-${Date.now()}`, to: [roles[0].id], mode: "sequential", ackMins: 10 }]);
  const removeLevel = (id: string) => setLevels((l) => (l.length > 1 ? l.filter((x) => x.id !== id) : l));

  const respEff = Math.max(1, Math.round(cat.responseMins * multipliers[prio]));
  const events: { t: number; title: string; who?: string[]; par?: boolean; ack?: number; sub?: string; tone: Tone }[] = [
    { t: 0, title: "Ticket created", sub: `Assignee notified. Must respond within ${fmt(respEff)}.`, tone: "slate" },
  ];
  let t = respEff;
  events.push({ t, title: "Response threshold breached", sub: "Escalation protocol starts", tone: "red" });
  levels.forEach((lv, i) => {
    const par = lv.mode === "parallel" || (prio === "Urgent" && urgentParallel);
    events.push({ t, title: `Level ${i + 1} notified`, who: lv.to.map((id) => roleName(roles, id)), par, ack: lv.ackMins, tone: par ? "purple" : "blue" });
    t += par ? lv.ackMins : lv.ackMins * lv.to.length;
  });
  events.push({ t, title: "Chain exhausted", sub: "Ticket flagged on dashboard for Super Admin review", tone: "red" });

  return <>
    <Note tone="blue"><strong>How notifications flow.</strong> Normal notifications go one person at a time, up the hierarchy. Each escalation level can instead notify everyone in it at once (parallel). Every notification expires; if nobody acts in time, the chain moves to the next level.</Note>
    <div className="ent-catbar ent-gap">{categories.map((c) => <Chip key={c.id} on={c.id === cat.id} onClick={() => setCatId(c.id)}>{c.name}</Chip>)}</div>
    <div className="ent-two ent-gap">
      <Panel>
        <PanelHeader title={`${cat.name} escalation chain`} subtitle={`Respond within ${fmt(cat.responseMins)} · resolve within ${fmt(cat.resolveMins)}`} action={<Btn variant="primary" icon="plus" onClick={addLevel}>Add level</Btn>} />
        <div className="ent-levels">
          {levels.map((lv, i) => <div className="ent-level-card" key={lv.id}>
            <div className="ent-level-head"><span className="ent-level">{i + 1}</span><strong>Level {i + 1}</strong><span className="ent-spacer" />{levels.length > 1 && <span className="text-link" role="button" onClick={() => removeLevel(lv.id)}>Remove</span>}</div>
            <div className="ent-field"><span>Notify</span><div className="ent-chips">{lowToHigh.map((r) => <Chip key={r.id} on={lv.to.includes(r.id)} onClick={() => toggleRole(lv, r.id)}>{r.name}</Chip>)}</div></div>
            <div className="ent-field-row">
              <div className="ent-field"><span>Delivery</span><Segmented value={lv.mode} onChange={(v) => patch(lv.id, { mode: v as Mode })} options={[["sequential", "Sequential"], ["parallel", "Parallel"]]} /></div>
              <div className="ent-field"><span>Must act within (min)</span><input className="ent-num" type="number" min={1} value={lv.ackMins} onChange={(e) => patch(lv.id, { ackMins: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></div>
            </div>
            <small className="ent-hint">{lv.mode === "parallel" ? "Everyone in this level is alerted together. First to act closes it for all." : lv.to.length > 1 ? "Alerted one after another by hierarchy, each with their own window." : "Single recipient."} Notification expires after {fmt(lv.ackMins)}.</small>
          </div>)}
        </div>
      </Panel>
      <Panel>
        <PanelHeader title="Timeline preview" subtitle="What happens if nobody responds" action={<Segmented value={prio} onChange={(v) => setPrio(v as Priority)} options={PRIORITIES.map((p) => [p, p])} />} />
        <div className="ent-toggle-row"><Toggle on={urgentParallel} onClick={() => setUrgentParallel((v) => !v)} /><span>Urgent tickets notify every level in parallel</span></div>
        <div className="ent-timeline">
          {events.map((e, i) => <div key={i} className={`ent-event ent-event-${e.tone}`}>
            <span className="ent-event-time">T+{e.t === 0 ? "0" : fmt(e.t)}</span>
            <i className="ent-event-dot" />
            <div>
              <strong>{e.title}</strong>
              {e.who && <div className="ent-chips">{e.who.map((w) => <Badge key={w} tone={e.par ? "purple" : "blue"}>{w}</Badge>)}</div>}
              {e.who && <small>{e.par ? "Parallel" : "Sequential"} · expires in {fmt(e.ack ?? 0)} per notification</small>}
              {e.sub && <small>{e.sub}</small>}
            </div>
          </div>)}
        </div>
      </Panel>
    </div>
  </>;
}

/* ------------------------------------------------------------------ */
/* Skill-based next-available routing                                  */
/* ------------------------------------------------------------------ */
export function NextAvailablePanel() {
  const { categories, users, setUsers, roles } = useEnterprise();
  const [catId, setCatId] = useState(categories[0].id);
  const cat = categories.find((c) => c.id === catId) ?? categories[0];
  const rank = (a: Availability) => (a === "Available" ? 0 : a === "On call" ? 1 : 2);
  const pool = users.filter((u) => u.skills.includes(cat.name)).sort((a, b) => rank(a.availability) - rank(b.availability) || a.open - b.open);
  const eligible = pool.filter((u) => u.availability !== "Unavailable");
  const cycle = (id: string) => setUsers((p) => p.map((u) => (u.id === id ? { ...u, availability: u.availability === "Available" ? "On call" : u.availability === "On call" ? "Unavailable" : "Available" } : u)));
  const tone = (a: Availability): Tone => (a === "Available" ? "green" : a === "On call" ? "amber" : "slate");
  return <Panel>
    <PanelHeader title="Next available staff" subtitle="Skill match first, then availability, then lowest workload" action={<Badge tone="teal">Skill-based</Badge>} />
    <div className="ent-catbar ent-pad">{categories.map((c) => <Chip key={c.id} on={c.id === cat.id} onClick={() => setCatId(c.id)}>{c.name}</Chip>)}</div>
    <div className="ent-rows">
      <div className="ent-row head" style={{ gridTemplateColumns: "1fr 1.3fr .7fr .8fr .4fr" }}><span>Outcome</span><span>Staff member</span><span>Tier</span><span>Availability</span><span>Open</span></div>
      {pool.length === 0 && <div className="ent-row"><span className="ent-muted">Nobody has the {cat.name} skill yet. Add it when onboarding staff.</span></div>}
      {pool.map((u) => {
        const idx = eligible.findIndex((e) => e.id === u.id);
        const label = idx === 0 ? "Assigned next" : idx > 0 ? `Fallback ${idx}` : "Skipped";
        return <div className={`ent-row ${idx < 0 ? "dim" : ""}`} key={u.id} style={{ gridTemplateColumns: "1fr 1.3fr .7fr .8fr .4fr" }}>
          <span><Badge tone={idx === 0 ? "green" : idx > 0 ? "blue" : "slate"}>{label}</Badge></span>
          <span className="ent-user"><i className="avatar-small">{initials(u.name)}</i><strong>{u.name}</strong></span>
          <span>{roleName(roles, u.roleId)}</span>
          <span role="button" className="ent-click" title="Click to simulate a change" onClick={() => cycle(u.id)}><Badge tone={tone(u.availability)} dot>{u.availability}</Badge></span>
          <strong>{u.open}</strong>
        </div>;
      })}
    </div>
    {pool.length > 0 && eligible.length === 0 && <div className="ent-pad"><Note tone="red">Everyone with the {cat.name} skill is unavailable. The ticket goes to the team queue and the first escalation level is notified immediately.</Note></div>}
    <div className="ent-pad ent-hint-row"><Ico name="users" /><span>Click an availability badge to simulate someone going off shift. If the assignee becomes unavailable, the ticket moves to the next person with the same skill.</span></div>
  </Panel>;
}
