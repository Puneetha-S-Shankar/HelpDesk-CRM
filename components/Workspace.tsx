"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PermKey, Persona, Registry, RegistryEntry, Session, Tone, User, Workspace } from "@/lib/model";
import { buildRegistry, DEMO_VERSION, PERSONAS, seedDatabase } from "@/lib/seed";
import { accessibleLocationIds, can as canDo, checkLicence, type LicenceCheck, type Result } from "@/lib/workflows";

/* ------------------------------------------------------------------ */
/* Multi-tenant store — follows the ZongoVita standard approach:       */
/*                                                                     */
/*   1. Login           → a persona signs in (simulated)               */
/*   2. Identify        → customer comes from the persona's membership, */
/*                        never from free user input                   */
/*   3. Check licence   → Licence Registry, on every request           */
/*   4. Use that DB only→ only the signed-in customer's database is    */
/*                        loaded; each customer has its own storage key */
/*                                                                     */
/* The registry holds Customer → Licence and Customer → Database only. */
/*                                                                     */
/* SIMULATED: identity, permissions and storage are client-side. They  */
/* are not a security boundary.                                        */
/* ------------------------------------------------------------------ */

const REGISTRY_KEY = "propdesk.registry";
const SESSION_KEY = "propdesk.session";
const LEGACY_KEY = "propdesk.demo";

export type Membership = { customerId: string; customerName: string; userId: string; roleName: string };
type Toast = { id: number; tone: Tone; text: string };

type WsCtx = {
  ws: Workspace;
  entry: RegistryEntry | undefined;
  licence: LicenceCheck;
  /** Licence state of any customer, from the registry (no business data). */
  licenceFor: (customerId: string) => LicenceCheck;
  persona: Persona;
  me: User | undefined;
  memberships: Membership[];
  locationId: string;
  setLocationId: (id: string) => void;
  myLocationIds: string[];
  can: (perm: PermKey) => boolean;
  now: number;
  switchCustomer: (id: string) => void;
  switchPersona: (id: string) => void;
  resetDemo: () => void;
  updateWorkspace: (fn: (ws: Workspace) => Workspace) => void;
  updateLicence: (fn: (l: RegistryEntry["licence"]) => RegistryEntry["licence"]) => void;
  run: (fn: (ws: Workspace, me: User, now: number) => Result, success?: string) => Result;
  toast: (text: string, tone?: Tone) => void;
};

const Ctx = createContext<WsCtx | null>(null);

export function useWorkspace() {
  const c = useContext(Ctx);
  if (!c) throw new Error("WorkspaceProvider is missing");
  return c;
}

/* ---- storage helpers: one key per customer database ---- */
const read = <T,>(key: string): T | null => { try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };

/** Opens one customer's database, provisioning it from sample data the first time. */
function openDatabase(entry: RegistryEntry): Workspace {
  const db = read<Workspace>(entry.database);
  if (db?.customer?.id === entry.customerId) return db;
  const fresh = seedDatabase(entry.customerId)!;
  write(entry.database, fresh);
  return fresh;
}

/** Resolves the customer from the signed-in persona's memberships only. */
function resolveCustomer(persona: Persona, registry: Registry, wanted?: string): string | undefined {
  const allowed = persona.memberships.map((m) => m.customerId).filter((id) => registry.customers.some((c) => c.customerId === id));
  return wanted && allowed.includes(wanted) ? wanted : allowed[0];
}

type State = { registry: Registry; session: Session; db: Workspace | null };

function boot(): { state: State; notice?: string } {
  let notice: string | undefined;
  let registry = read<Registry>(REGISTRY_KEY);
  if (!registry || registry.version !== DEMO_VERSION) {
    if (registry || localStorage.getItem(LEGACY_KEY)) notice = "Saved demo data was from an older version and has been reset.";
    registry?.customers.forEach((c) => localStorage.removeItem(c.database));
    localStorage.removeItem(LEGACY_KEY);
    registry = buildRegistry();
    write(REGISTRY_KEY, registry);
  }
  const saved = read<Session>(SESSION_KEY);
  const persona = PERSONAS.find((p) => p.id === saved?.personaId) ?? PERSONAS[0];
  const customerId = resolveCustomer(persona, registry, saved?.customerId);
  const entry = registry.customers.find((c) => c.customerId === customerId);
  return { state: { registry, session: { personaId: persona.id, customerId: customerId ?? "", locationId: saved?.locationId ?? "all" }, db: entry ? openDatabase(entry) : null }, notice };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [saveFailed, setSaveFailed] = useState(false);

  const toast = useCallback((text: string, tone: Tone = "green") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  // Client-only load avoids a server/client hydration mismatch.
  useEffect(() => {
    const { state: s, notice } = boot();
    setState(s);
    if (notice) toast(notice, "amber");
    const i = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(i);
  }, [toast]);

  // Persist each store separately: registry, session, and ONLY the active customer's database.
  useEffect(() => { if (state) setSaveFailed(!write(REGISTRY_KEY, state.registry)); }, [state?.registry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state) write(SESSION_KEY, state.session); }, [state?.session]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state?.db) return;
    const entry = state.registry.customers.find((c) => c.customerId === state.db!.customer.id);
    if (entry) setSaveFailed(!write(entry.database, state.db));
  }, [state?.db]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<WsCtx | null>(() => {
    if (!state?.db) return null;
    const { registry, session, db: ws } = state;
    const persona = PERSONAS.find((p) => p.id === session.personaId) ?? PERSONAS[0];
    const entry = registry.customers.find((c) => c.customerId === ws.customer.id);
    const licence = checkLicence(entry, now);
    // Registry gives customer names; roles come from the identity provider. No other customer's DB is read.
    const memberships: Membership[] = persona.memberships.flatMap((m) => {
      const e = registry.customers.find((c) => c.customerId === m.customerId);
      return e ? [{ customerId: e.customerId, customerName: e.name, userId: m.userId, roleName: m.role }] : [];
    });
    const me = ws.users.find((u) => u.id === memberships.find((m) => m.customerId === ws.customer.id)?.userId);
    const myLocationIds = licence.ok ? accessibleLocationIds(ws, me) : [];
    const locationId = myLocationIds.includes(session.locationId) ? session.locationId : myLocationIds.length === 1 ? myLocationIds[0] : "all";

    const blocked = () => { if (!licence.ok) toast(licence.reason, "red"); return !licence.ok; };
    const updateWorkspace = (fn: (w: Workspace) => Workspace) => { if (!blocked()) setState((s) => s && s.db && ({ ...s, db: fn(s.db) })); };
    const run: WsCtx["run"] = (fn, success) => {
      // Licence is checked on every request before touching the customer's data.
      const lc = checkLicence(entry, Date.now());
      if (!lc.ok) { toast(lc.reason, "red"); return { ok: false, error: lc.reason }; }
      if (!me) { toast("You are not a member of this workspace.", "red"); return { ok: false, error: "No access" }; }
      const r = fn(ws, me, Date.now());
      if (r.ok) { const next = r.ws; setState((s) => s && { ...s, db: next }); if (success) toast(success); }
      else toast(r.error, "red");
      return r;
    };
    /** Signing into another customer: close this DB, open that customer's DB. */
    const enter = (s: State, p: Persona, wanted?: string): State => {
      const customerId = resolveCustomer(p, s.registry, wanted);
      const e = s.registry.customers.find((c) => c.customerId === customerId);
      return e ? { ...s, session: { personaId: p.id, customerId: e.customerId, locationId: "all" }, db: openDatabase(e) } : s;
    };

    return {
      ws, entry, licence, licenceFor: (id) => checkLicence(registry.customers.find((c) => c.customerId === id), now), persona, me, memberships, locationId, myLocationIds, now, toast, run, updateWorkspace,
      can: (perm) => licence.ok && canDo(ws, me, perm),
      setLocationId: (id) => setState((s) => s && { ...s, session: { ...s.session, locationId: id } }),
      updateLicence: (fn) => setState((s) => s && { ...s, registry: { ...s.registry, customers: s.registry.customers.map((c) => (c.customerId === ws.customer.id ? { ...c, licence: fn(c.licence) } : c)) } }),
      switchCustomer: (id) => setState((s) => (s && memberships.some((m) => m.customerId === id) ? enter(s, persona, id) : s)),
      switchPersona: (id) => setState((s) => { const p = PERSONAS.find((x) => x.id === id); return s && p ? enter(s, p, s.session.customerId) : s; }),
      resetDemo: () => {
        setState((s) => {
          s?.registry.customers.forEach((c) => localStorage.removeItem(c.database));
          const registry = buildRegistry();
          write(REGISTRY_KEY, registry);
          const p = PERSONAS.find((x) => x.id === s?.session.personaId) ?? PERSONAS[0];
          return enter({ registry, session: s?.session ?? { personaId: p.id, customerId: "", locationId: "all" }, db: null }, p, s?.session.customerId);
        });
        toast("Sample data reset: Licence Registry and every customer database.", "blue");
      },
    };
  }, [state, now, toast]);

  if (!value) return <div className="boot-screen"><span className="brand-mark"><span /></span><strong>{state ? "No customer workspace for this account" : "Loading PropDesk workspace…"}</strong><small>{state ? "This sign-in has no customer in the Licence Registry." : "Signing in · identifying customer · checking licence"}</small></div>;

  return <Ctx.Provider value={value}>
    {children}
    <div className="toast-stack" role="status" aria-live="polite">
      {saveFailed && <div className="toast toast-amber">Changes can&apos;t be saved in this browser (storage is blocked). They will be lost on refresh.</div>}
      {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
    </div>
  </Ctx.Provider>;
}
