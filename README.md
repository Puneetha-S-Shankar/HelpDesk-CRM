# PropDesk (Next.js)

Helpdesk CRM front end. Next.js App Router, TypeScript, Tailwind v4.

    npm install
    npm run dev        # http://localhost:3000
    npm test           # workflow unit tests (Node's built-in test runner)
    npm run typecheck
    npm run build

- `components/App.tsx` shell, sidebar, workspace/persona switchers, dashboard, routing, SLA, AI, reports
- `components/Tickets.tsx` ticket queue, pending review queue, ticket detail + activity timeline, decline / review / reassign modals, create ticket
- `components/Locations.tsx` apartment location management (Properties page)
- `components/Enterprise.tsx` roles, users + skills, categories, decline reasons, licensing, SLA policies, escalation builder, skill routing
- `components/Workspace.tsx` central store: customer workspaces, simulated sign-in, persistence, toasts
- `components/ui.tsx` shared primitives (buttons, badges, panels, modal)
- `lib/model.ts` data model · `lib/seed.ts` sample data · `lib/workflows.ts` pure workflow rules (+ tests)

## Frontend prototype — what is simulated

There is **no backend or database**. Everything runs in the browser:

- **Data** is sample data for three customers on the Zongovita platform (Prestige Group, Harbourline Property Management, and Skyline Habitat Services, whose licence is expired), each persisted to its own `localStorage` key. Use the user menu at the bottom of the sidebar → **Reset demo data** to restore it.
- **Sign-in is simulated.** The user menu switches between personas (customer super admin, regional admin, site manager, staff, and a Zongovita user with access to all three customers).
- **Permission checks are simulated** and only decide what the UI shows. They are not a security boundary — anyone with devtools can change them. Real enforcement must happen on the server.
- **Notifications** are in-app only (bell icon). No email, SMS or push is sent.
- **AI analysis** on Create ticket is keyword rules standing in for a model.

## Multi-tenant approach (ZongoVita standard)

Follows `../multi_tenant_customer-licensing-diagram.jpg`: one application, separate data per customer.

1. **One database per customer.** Each customer's data is stored under its own key (`propdesk.db.<customerId>`). Only the signed-in customer's database is loaded; nothing mixes two customers.
2. **Sites stay inside their customer's database.** Locations, staff, tickets and settings are part of that customer's database.
3. **Customer is identified at login.** The (simulated) sign-in resolves the customer from the account's memberships; the switcher only offers customers the account belongs to.
4. **Licence is checked on every request.** `propdesk.registry` is the Licence Registry: Customer → Licence (validity, sites, users, modules) and Customer → Database, with no business data. Every action runs `checkLicence` first; an expired licence blocks all of that customer's sites (try *Skyline Habitat Services* as Kavya Rao or Neha Joshi). Site and user limits and licensed modules come from the registry.
5. **New customer = new database + one registry entry.** `seedDatabase()` + a `buildRegistry()` entry; existing customers are untouched.

## Workflows

**Decline:** the assignee clicks *Decline ticket*, picks a mandatory reason (configured per customer under Administration → Decline reasons; reasons can require an explanation, e.g. *Other*). The ticket becomes *Pending Admin Review*, stays with the assignee, and reviewers for that location are notified.

**Review:** Tickets → *Pending review* (or the banner on the ticket) lets anyone with the *Review declines* permission at that location:
- *Approve* → team queue (or pick a person),
- *Approve & reassign* → recommended staff ranked by skill, location, availability and live workload, with an override,
- *Reject* → mandatory comment; the ticket returns to the original assignee in its previous status and they are notified.

Every step is written to the ticket's activity timeline.

**Multi-customer:** Zongovita → customer → locations → staff → tickets. Each customer's roles, permissions, users, categories, decline reasons, SLA policies, escalation chains, routing and locations live in its own workspace object; edits only touch the active one. Role *location access* (all vs. assigned) plus each user's assigned locations decide which locations, tickets and staff they see.

## Connecting a backend later

Each function in `lib/workflows.ts` (`requestDecline`, `approveDecline`, `rejectDecline`, `reassignTicket`, `createTicket`, …) maps to one API call. `lib/model.ts` is a starting point for the schema. Replace `Workspace.tsx`'s localStorage load/save with API fetches, move every permission check server-side, and replace personas with real authentication.
