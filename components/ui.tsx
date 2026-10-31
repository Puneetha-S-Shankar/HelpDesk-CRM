"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Priority, Sentiment, TicketStatus, Tone } from "@/lib/model";

/* Shared primitives. Same class names as the original App.tsx so new
   screens inherit the existing PropDesk design system. */

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
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
    down: <path d="m6 9 6 6 6-6" />,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6m-6 4h6" /></>,
    download: <><path d="M12 4v12m0 0 5-5m-5 5-5-5" /><path d="M4 20h16" /></>,
    decline: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>,
    shield: <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z" />,
    pin: <><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z" /><circle cx="12" cy="10" r="2" /></>,
    swap: <><path d="M7 4 3 8l4 4M3 8h14" /><path d="m17 20 4-4-4-4m4 4H7" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13 7 4 4" /></>,
    alert: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4m0 3v.5" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    lock: <><rect x="5" y="11" width="14" height="9" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>;
}

type Variant = "primary" | "secondary" | "danger" | "purple";
export function Button({ children, variant = "secondary", icon, onClick, disabled, title }: { children: ReactNode; variant?: Variant; icon?: string; onClick?: () => void; disabled?: boolean; title?: string }) {
  return <div className={`button ${variant} ${disabled ? "disabled" : ""}`} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined} title={title}
    onClick={disabled ? undefined : onClick}
    onKeyDown={(e) => { if (!disabled && onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}>
    {icon && <Icon name={icon} />}{children}
  </div>;
}

export function Badge({ children, tone = "slate", dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="status-dot" />}{children}</span>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="panel-header"><div><div className="panel-title">{title}</div>{subtitle && <div className="panel-subtitle">{subtitle}</div>}</div>{action}</div>;
}

export function Note({ tone = "blue", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`ent-note ent-note-${tone}`}>{children}</div>;
}

export function EmptyState({ icon = "inbox", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={24} /></span><strong>{title}</strong>{children && <span>{children}</span>}{action}</div>;
}

/** Accessible modal: Escape closes, focus moves into the dialog and returns on close. */
export function Modal({ title, subtitle, onClose, children, footer, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(".modal-body select, .modal-body textarea, .modal-body input, .modal-footer [role=button]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <div className="modal-header"><div><div className="panel-title">{title}</div>{subtitle && <div className="panel-subtitle">{subtitle}</div>}</div><span className="modal-close" role="button" aria-label="Close" onClick={onClose}><Icon name="x" size={14} /></span></div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  </div>;
}

export function ConfirmDialog({ title, body, confirm, tone = "primary", onConfirm, onClose }: { title: string; body: ReactNode; confirm: string; tone?: Variant; onConfirm: () => void; onClose: () => void }) {
  return <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={tone} onClick={() => { onConfirm(); onClose(); }}>{confirm}</Button></>}>
    <div className="modal-text">{body}</div>
  </Modal>;
}

/* ------------------------------------------------------------------ */
/* Tones and formatting                                                */
/* ------------------------------------------------------------------ */
export const statusTone = (s: TicketStatus): Tone =>
  s === "Escalated" ? "red" : s === "In Progress" ? "blue" : s === "Pending Admin Review" ? "purple" : s === "Resolved" ? "green" : "slate";
export const priorityTone = (p: Priority): Tone => (p === "Urgent" ? "red" : p === "High" ? "amber" : "slate");
export const sentimentTone = (s: Sentiment): Tone => (s === "Negative" ? "red" : s === "Positive" ? "green" : "slate");
export const slaTone = (s: string): Tone => (s === "Breached" ? "red" : s === "At risk" ? "amber" : "green");
export const availTone = (a: string): Tone => (a === "Available" ? "green" : a === "On call" ? "amber" : "slate");

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function day(iso: string, now: number) {
  const d = new Date(iso), n = new Date(now);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, n)) return "Today";
  if (sameDay(d, new Date(now - 86400000))) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === n.getFullYear() ? undefined : "numeric" });
}
export const when = (iso: string, now: number) => `${day(iso, now)}, ${clock(iso)}`;
