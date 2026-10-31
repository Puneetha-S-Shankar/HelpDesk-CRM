/* ------------------------------------------------------------------ */
/* PropDesk frontend data model                                        */
/*                                                                     */
/* Hierarchy: Zongovita platform → Customer → Locations → Staff →      */
/* Tickets. Everything a customer owns lives inside its Workspace, so  */
/* edits in one workspace can never touch another.                     */
/*                                                                     */
/* PROTOTYPE ONLY: this is client-side state. Permission checks built  */
/* on it are simulated and are not a security boundary.                */
/* ------------------------------------------------------------------ */

export type Tone = "blue" | "green" | "amber" | "red" | "purple" | "teal" | "slate";
export type Availability = "Available" | "On call" | "Unavailable";
export type Mode = "sequential" | "parallel";
export type Priority = "Urgent" | "High" | "Normal" | "Low";
export type Sentiment = "Negative" | "Neutral" | "Positive";

export const PRIORITIES: Priority[] = ["Urgent", "High", "Normal", "Low"];

export const PERMS = [
  ["view", "View tickets"],
  ["create", "Create tickets"],
  ["edit", "Edit tickets"],
  ["delete", "Delete tickets"],
  ["reassign", "Reassign tickets"],
  ["decline", "Decline tickets"],
  ["review", "Review declines"],
  ["locations", "Manage locations"],
  ["config", "Configure SLA & routing"],
  ["users", "Manage users"],
  ["billing", "Licensing & billing"],
] as const;
export type PermKey = (typeof PERMS)[number][0];
export type PermMatrix = Record<string, Record<string, boolean>>;

/** "all" = every location of the customer; "assigned" = only the user's locationIds. */
export type LocationScope = "all" | "assigned";

export type Category = { id: string; name: string; responseMins: number; resolveMins: number };
export type Role = { id: string; name: string; desc: string; kind: "system" | "tier"; locked?: boolean; scope?: LocationScope };
export type User = {
  id: string; name: string; email: string; roleId: string; skills: string[]; availability: Availability;
  /** Live count of active tickets. Derived from tickets when exposed through context; stored value is ignored. */
  open: number;
  locationIds: string[]; team?: string;
};
export type Level = { id: string; to: string[]; mode: Mode; ackMins: number };
/* ------------------------------------------------------------------ */
/* Licence Registry (ZongoVita standard multi-tenant approach)         */
/* Customer → Licence and Customer → its Database. Holds NO customer   */
/* business data: no tickets, users, sites or settings.                */
/* ------------------------------------------------------------------ */
export const MODULES = ["helpdesk", "sla", "ai", "reports", "migration"] as const;
export type ModuleKey = (typeof MODULES)[number];
export type Licence = {
  plan: string;
  /** ISO date (inclusive). After this every site of the customer is blocked. */
  validUntil: string;
  maxSites: number; maxUsers: number; modules: ModuleKey[]; pricePerSeat: number;
};
export type RegistryEntry = {
  customerId: string; name: string; short: string; region: string;
  licence: Licence;
  /** Which database holds this customer's data (a localStorage key in the prototype). */
  database: string;
};
export type Registry = { version: number; customers: RegistryEntry[] };

export type Customer = { id: string; name: string; short: string; region: string; ticketPrefix: string; nextTicketNo: number };

export type Location = {
  id: string; name: string; code: string; city: string; address: string;
  units: number; occupied: number; blocks: string; officeHours: string; emergencyContact: string;
  status: "Active" | "Onboarding"; avgResolveHrs: number;
};

export type DeclineReason = { id: string; label: string; requiresExplanation: boolean; active: boolean };

export type TicketStatus = "Open" | "In Progress" | "Escalated" | "Pending Admin Review" | "Resolved";
export const ACTIVE_STATUSES: TicketStatus[] = ["Open", "In Progress", "Escalated", "Pending Admin Review"];

export type DeclineState = "pending" | "approved" | "rejected";
export type DeclineRequest = {
  id: string; reasonId: string;
  /** Snapshot so history survives the reason being renamed or removed later. */
  reasonLabel: string;
  explanation: string; requestedById: string; requestedByName: string; requestedAt: string;
  previousStatus: TicketStatus; state: DeclineState;
  reviewedById?: string; reviewedByName?: string; reviewedAt?: string; reviewComment?: string;
  /** Where the ticket went after the review, for audit. */
  outcome?: string;
};

export type EventSource = "crm" | "ai" | "system" | "staff" | "manager";
export type EventType =
  | "created" | "ai" | "assigned" | "accepted" | "sla" | "note" | "escalated" | "resolved"
  | "decline_requested" | "decline_reason" | "decline_approved" | "decline_rejected" | "reassigned" | "queued";
export type TicketEvent = { id: string; at: string; type: EventType; source: EventSource; actorName: string; text: string; detail?: string };

export type Ticket = {
  id: string; title: string; description: string; tenant: string; contact: string; channel: string;
  locationId: string; unit: string; categoryId: string; priority: Priority; sentiment: Sentiment; tags: string[];
  /** null = in the team queue. */
  assigneeId: string | null;
  status: TicketStatus; createdAt: string; resolvedAt?: string;
  declines: DeclineRequest[]; history: TicketEvent[];
};

export type Notification = {
  id: string; at: string; title: string; body: string; ticketId: string; locationId: string;
  /** Direct recipients. */
  toUserIds?: string[];
  /** Or everyone holding this permission at the ticket's location. */
  toPerm?: PermKey;
  readBy: string[];
};

export type RoutingRule = { id: string; locationId: string | "all"; categoryId: string; primaryId: string; backupId: string; managerId: string };

export type Workspace = {
  customer: Customer;
  locations: Location[];
  roles: Role[]; perms: PermMatrix; users: User[];
  categories: Category[]; chains: Record<string, Level[]>; multipliers: Record<Priority, number>;
  declineReasons: DeclineReason[];
  routingRules: RoutingRule[];
  tickets: Ticket[];
  notifications: Notification[];
  trend: { created: number[]; resolved: number[] };
};

/** A simulated sign-in identity. One person can belong to several customers. */
/** A simulated identity-provider account. The customer comes from its memberships, never from user input. */
export type Persona = { id: string; name: string; title: string; memberships: { customerId: string; userId: string; role: string }[] };

/** Signed-in session: who logged in and which customer that resolved to. */
export type Session = { personaId: string; customerId: string; locationId: string };
