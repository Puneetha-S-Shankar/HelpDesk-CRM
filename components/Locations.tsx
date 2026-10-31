"use client";

import { useState } from "react";
import type { Location } from "@/lib/model";
import { categoryOf, initials, siteLimitReached, isActive, isStaffRole, openCount, pendingDecline, roleOf, slaInfo, userName } from "@/lib/workflows";
import { useWorkspace } from "./Workspace";
import { availTone, Badge, Button, EmptyState, Icon, Modal, Note, Panel, PanelHeader, priorityTone, statusTone, when } from "./ui";

/* Apartment location management for the active customer. */

export function LocationsPage({ onTicket }: { onTicket: (id: string) => void }) {
  const { ws, entry, me, myLocationIds, locationId, can, now, updateWorkspace, toast } = useWorkspace();
  const atLimit = siteLimitReached(entry, ws);
  const locs = ws.locations.filter((l) => myLocationIds.includes(l.id));
  const [sel, setSel] = useState(locationId !== "all" ? locationId : locs[0]?.id);
  const [edit, setEdit] = useState<Location | "new" | null>(null);
  const [manageStaff, setManageStaff] = useState(false);
  const manage = can("locations");
  const loc = locs.find((l) => l.id === sel) ?? locs[0];

  const stats = (id: string) => {
    const ts = ws.tickets.filter((t) => t.locationId === id);
    const act = ts.filter(isActive);
    const within = act.filter((t) => slaInfo(ws, t, now).state !== "Breached").length;
    return {
      open: act.length, pending: act.filter((t) => pendingDecline(t)).length, queue: act.filter((t) => t.assigneeId === null).length,
      sla: act.length ? Math.round((within / act.length) * 100) : 100,
      staff: ws.users.filter((u) => isStaffRole(ws, u) && u.locationIds.includes(id)).length,
    };
  };

  const save = (l: Location, isNew: boolean) => {
    // Licence Registry caps the number of sites for this customer.
    if (isNew && atLimit) return toast(`Licence allows ${entry?.licence.maxSites} sites. Renew or upgrade the licence to add more.`, "red");
    updateWorkspace((w) => ({
      ...w,
      locations: isNew ? [...w.locations, l] : w.locations.map((x) => (x.id === l.id ? l : x)),
      // A delegated admin who adds a location gets access to it straight away.
      users: isNew && me && roleOf(w, me)?.scope !== "all" ? w.users.map((u) => (u.id === me.id ? { ...u, locationIds: [...u.locationIds, l.id] } : u)) : w.users,
    }));
    setSel(l.id);
    toast(isNew ? `${l.name} added to ${ws.customer.name}.` : `${l.name} updated.`);
  };
  const toggleStaff = (userId: string, on: boolean) => {
    if (!loc) return;
    updateWorkspace((w) => ({ ...w, users: w.users.map((u) => (u.id === userId ? { ...u, locationIds: on ? [...u.locationIds, loc.id] : u.locationIds.filter((x) => x !== loc.id) } : u)) }));
  };

  if (!loc) return <div className="page-content"><Panel><EmptyState icon="building" title="No locations available" action={manage ? <Button variant="primary" icon="plus" onClick={() => setEdit("new")}>Add location</Button> : undefined}>{manage ? `${ws.customer.name} has no apartment locations yet.` : "You have not been assigned to any location in this workspace. Ask an administrator."}</EmptyState></Panel>{edit && <LocationModal value={null} onClose={() => setEdit(null)} onSave={save} />}</div>;

  const st = stats(loc.id);
  const staffAt = ws.users.filter((u) => u.locationIds.includes(loc.id) && roleOf(ws, u)?.scope !== "all");
  const staffPool = ws.users.filter((u) => roleOf(ws, u)?.scope !== "all");
  const tickets = ws.tickets.filter((t) => t.locationId === loc.id).sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || b.createdAt.localeCompare(a.createdAt));

  return <div className="page-content">
    <div className="loc-head">
      <Note tone="blue"><strong>{ws.customer.name} · {ws.locations.length} location{ws.locations.length === 1 ? "" : "s"}.</strong> {manage ? "You can add locations, edit details and assign staff." : `You can view the ${locs.length === 1 ? "location" : `${locs.length} locations`} assigned to you.`} Each location has its own staff and ticket visibility.</Note>
      {manage && <Button variant="primary" icon="plus" disabled={atLimit} title={atLimit ? `Licence limit: ${entry?.licence.maxSites} sites` : undefined} onClick={() => setEdit("new")}>{atLimit ? `Site limit reached (${ws.locations.length}/${entry?.licence.maxSites})` : "Add location"}</Button>}
    </div>
    <div className="loc-cards">
      {locs.map((l) => {
        const s = stats(l.id);
        return <div key={l.id} className={`panel loc-card ${l.id === loc.id ? "selected" : ""}`} role="button" tabIndex={0} onClick={() => { setSel(l.id); setManageStaff(false); }} onKeyDown={(e) => e.key === "Enter" && setSel(l.id)}>
          <div className="loc-card-top"><span className="property-avatar">{l.code.slice(0, 2)}</span><span><strong>{l.name}</strong><small>{l.address}, {l.city}</small></span>{l.status !== "Active" && <Badge tone="amber">{l.status}</Badge>}</div>
          <div className="loc-card-stats"><span><b>{s.open}</b>open</span><span><b className={s.sla < 90 ? "danger-text" : "success-text"}>{s.sla}%</b>in SLA</span><span><b className={s.pending ? "warning-text" : ""}>{s.pending}</b>pending review</span><span><b>{s.staff}</b>staff</span></div>
        </div>;
      })}
    </div>
    <div className="ent-two ent-two-wide-left ent-gap">
      <div className="detail-main">
        <Panel>
          <PanelHeader title={loc.name} subtitle={`${loc.code} · ${loc.address}, ${loc.city}`} action={manage ? <Button icon="edit" onClick={() => setEdit(loc)}>Edit details</Button> : <Badge tone="green" dot>{loc.status}</Badge>} />
          <div className="loc-info">
            <span><small>UNITS</small><strong>{loc.units.toLocaleString()}</strong></span>
            <span><small>OCCUPANCY</small><strong>{loc.units ? Math.round((loc.occupied / loc.units) * 100) : 0}%</strong><em>{loc.occupied.toLocaleString()} occupied</em></span>
            <span><small>BLOCKS / TOWERS</small><strong>{loc.blocks}</strong></span>
            <span><small>OFFICE HOURS</small><strong>{loc.officeHours}</strong></span>
            <span><small>EMERGENCY LINE</small><strong>{loc.emergencyContact}</strong></span>
            <span><small>AVG. RESOLVE</small><strong>{loc.avgResolveHrs}h</strong></span>
          </div>
          <div className="state-grid loc-kpis">
            <div className="state-card"><Badge tone="blue">Open tickets</Badge><strong>{st.open}</strong><span>{st.queue} in team queue</span></div>
            <div className={`state-card ${st.sla < 90 ? "red" : ""}`}><Badge tone={st.sla < 90 ? "red" : "green"}>SLA compliance</Badge><strong>{st.sla}%</strong><span>of active tickets</span></div>
            <div className="state-card purple"><Badge tone="purple">Pending review</Badge><strong>{st.pending}</strong><span>decline requests</span></div>
            <div className="state-card amber"><Badge tone="amber">Staff on site</Badge><strong>{st.staff}</strong><span>{staffAt.filter((u) => u.availability === "Available").length} available now</span></div>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Tickets at this location" subtitle={`${tickets.length} total · visible only to people assigned to ${loc.name}`} />
          <div className="table-scroll"><div className="ent-rows loc-tickets">
            <div className="ent-row head"><span>Ticket</span><span>Issue</span><span>Category</span><span>Priority</span><span>Assignee</span><span>Status</span></div>
            {tickets.length === 0 && <div className="ent-row"><span className="ent-muted">No tickets yet.</span></div>}
            {tickets.slice(0, 10).map((t) => <div className="ent-row ent-click-row" key={t.id} role="button" onClick={() => onTicket(t.id)}>
              <span><strong className="ticket-id">{t.id}</strong><small className="ent-block-muted">{when(t.createdAt, now)}</small></span>
              <span>{t.title}<small className="ent-block-muted">{t.tenant} · {t.unit}</small></span>
              <span>{categoryOf(ws, t)?.name}</span><span><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge></span>
              <span>{userName(ws, t.assigneeId)}</span><span><Badge tone={statusTone(t.status)}>{t.status === "Pending Admin Review" ? "Pending review" : t.status}</Badge></span>
            </div>)}
          </div></div>
        </Panel>
      </div>
      <Panel>
        <PanelHeader title="Staff assigned" subtitle="Only these people see this location's tickets" action={manage ? <Button onClick={() => setManageStaff((v) => !v)}>{manageStaff ? "Done" : "Manage staff"}</Button> : undefined} />
        <div className="ent-rows">
          {(manageStaff ? staffPool : staffAt).map((u) => {
            const on = u.locationIds.includes(loc.id);
            return <div className={`ent-row tall loc-staff ${manageStaff && !on ? "dim" : ""}`} key={u.id}>
              <span className="ent-user"><i className="avatar-small">{initials(u.name)}</i><span><strong>{u.name}</strong><small>{roleOf(ws, u)?.name}{u.skills.length ? ` · ${u.skills.join(", ")}` : ""}</small></span></span>
              {manageStaff
                ? <span className={`ent-check ${on ? "on" : ""} ${u.id === me?.id ? "locked" : ""}`} role="checkbox" aria-checked={on} aria-label={`Assign ${u.name}`} onClick={u.id === me?.id ? undefined : () => toggleStaff(u.id, !on)}>{on && <Icon name="check" size={11} />}</span>
                : <span className="loc-staff-meta"><Badge tone={availTone(u.availability)} dot>{u.availability}</Badge><small>{openCount(ws, u.id)} open</small></span>}
            </div>;
          })}
          {!manageStaff && staffAt.length === 0 && <div className="ent-row"><span className="ent-muted">Nobody is assigned yet.</span></div>}
        </div>
        <div className="ent-pad ent-hint-row"><Icon name="shield" size={13} /><span>{ws.users.filter((u) => roleOf(ws, u)?.scope === "all").map((u) => u.name).join(", ") || "Customer-wide admins"} can see every location through their role.</span></div>
      </Panel>
    </div>
    {edit && <LocationModal value={edit === "new" ? null : edit} existing={ws.locations} onClose={() => setEdit(null)} onSave={save} />}
  </div>;
}

function LocationModal({ value, existing = [], onClose, onSave }: { value: Location | null; existing?: Location[]; onClose: () => void; onSave: (l: Location, isNew: boolean) => void }) {
  const [f, setF] = useState<Location>(value ?? { id: `loc-${Date.now()}`, name: "", code: "", city: "", address: "", units: 0, occupied: 0, blocks: "", officeHours: "09:00–18:00, Mon–Sat", emergencyContact: "", status: "Onboarding", avgResolveHrs: 0 });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Location, num = false) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: num ? Math.max(0, parseInt(e.target.value, 10) || 0) : e.target.value }));
  const submit = () => {
    if (!f.name.trim() || !f.code.trim() || !f.city.trim()) return setErr("Name, code and city are required.");
    if (existing.some((l) => l.id !== f.id && l.name.trim().toLowerCase() === f.name.trim().toLowerCase())) return setErr(`A location called "${f.name.trim()}" already exists for this customer.`);
    if (f.occupied > f.units) return setErr("Occupied units can't exceed total units.");
    onSave({ ...f, name: f.name.trim(), code: f.code.trim().toUpperCase() }, !value);
    onClose();
  };
  const field = (label: string, k: keyof Location, opts: { num?: boolean; ph?: string; req?: boolean } = {}) =>
    <label className="modal-field"><span>{label}{opts.req && <b className="req">required</b>}</span><input className="ent-input" type={opts.num ? "number" : "text"} min={0} value={String(f[k])} onChange={set(k, opts.num)} placeholder={opts.ph} /></label>;
  return <Modal wide title={value ? `Edit ${value.name}` : "Add apartment location"} subtitle="Location details are only visible inside this customer workspace" onClose={onClose}
    footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" onClick={submit}>{value ? "Save changes" : "Add location"}</Button></>}>
    <div className="modal-grid">
      {field("Location name", "name", { req: true, ph: "e.g. Prestige Jindal City" })}
      {field("Short code", "code", { req: true, ph: "e.g. PJC" })}
      {field("City", "city", { req: true })}
      {field("Address", "address")}
      {field("Total units", "units", { num: true })}
      {field("Occupied units", "occupied", { num: true })}
      {field("Blocks / towers", "blocks", { ph: "e.g. 8 towers" })}
      {field("Office hours", "officeHours")}
      {field("Emergency contact", "emergencyContact")}
      <label className="modal-field"><span>Status</span><select className="ent-input" value={f.status} onChange={set("status")}><option>Onboarding</option><option>Active</option></select></label>
    </div>
    {err && <Note tone="red">{err}</Note>}
  </Modal>;
}
