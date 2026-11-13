"use client";

type Block = { label: string; text: string };
type Step = { n: string; title: string; when: string; kind: string; blocks: Block[] };

const people = [
  ["Maya Patel", "Tenant", "The Foundry, unit 4B"],
  ["Olivia Price", "Super Admin", "Logged the call at 10:42"],
  ["Dana Hughes", "Type 3", "Primary · Heating · 6 open"],
  ["Marcus Lee", "Type 3", "Backup · Heating · 8 open"],
  ["Ruth Allen", "Type 1", "Manager on this property rule"],
  ["Priya Shah", "Type 2", "Escalation level 1 only"],
  ["Hannah Reid", "Regional Admin", "Escalation level 2"],
  ["James Cole", "Type 1", "Escalation level 2"],
  ["Alex Morgan", "Type 3", "Outside this ticket"],
];

const access = [
  ["Super Admin", "Olivia Price", "Logs the call and opens every screen. Level 3 if the chain runs out.", "View, create, edit, delete, reassign, SLA and routing, users, licensing"],
  ["Regional Admin", "Hannah Reid", "Notified only if escalation reaches level 2.", "View, create, edit, delete, reassign, SLA and routing, users"],
  ["Type 1", "Ruth Allen, James Cole", "Ruth is the property manager. Both are notified at level 2.", "View, create, edit, reassign"],
  ["Type 2", "Priya Shah", "Left out of Heating assignment. Notified at level 1 if the window is missed.", "View, create, edit, reassign"],
  ["Type 3", "Dana Hughes, Marcus Lee, Alex Morgan", "Dana is the assignee. Marcus is the backup. Alex is outside this ticket.", "View, create"],
];

const steps: Step[] = [
  {
    n: "1",
    title: "Link the tenant and lease",
    when: "Create ticket · 10:42",
    kind: "crm",
    blocks: [
      { label: "In the app", text: "Create ticket opens from the header. The Tenant & lease panel searches CRM records and marks the match Active tenant found, with a CRM data badge." },
      { label: "Where it goes", text: "The ticket locks to Maya Patel at The Foundry, unit 4B, lease L-10482, Active. The record contact is maya.patel@example.com and +44 7700 900421." },
      { label: "Who and why", text: "The caller matches an active tenant, so the property, unit, and lease are taken from that CRM record." },
      { label: "Who can see it", text: "Every role can view tickets, and every role can create tickets, so any of them can run this search. The shell is signed in as Olivia Price." },
    ],
  },
  {
    n: "2",
    title: "Capture the call notes",
    when: "Create ticket · 10:42",
    kind: "staff",
    blocks: [
      { label: "In the app", text: "Call details records an inbound call on +44 7700 900421, reported 14 Jan 2025 at 10:42, with a callback required today. The note is 275 characters and shows autosaved at 10:44." },
      { label: "Where it goes", text: "Onto the ticket as the issue note. Ticket detail shows it under Issue notes, tagged Staff action, written by Olivia Price at 10:42. Further notes are marked visible to staff only." },
      { label: "Who and why", text: "Olivia records a boiler that stopped overnight, a flat at 14°C, a young child in the property, and a restart that failed." },
      { label: "Who can see it", text: "Anyone who can view tickets can read it. Edit is Super Admin, Regional Admin, Type 1, and Type 2. Type 3 can view and create." },
    ],
  },
  {
    n: "3",
    title: "Classify the category",
    when: "AI analysis · 10:46",
    kind: "ai",
    blocks: [
      { label: "In the app", text: "The AI analysis panel on Create ticket, and the classification stage on AI & Sentiment. The timeline records it at 10:46 as AI generated." },
      { label: "Where it goes", text: "The category becomes Heating / Boiler failure. Routing rules and the skill pool both look up Heating." },
      { label: "Who and why", text: "The model reads the call notes. Category confidence is 97%. The analysis as a whole is 94%." },
      { label: "Who can see it", text: "The result sits on the ticket for every role with view. Changing categories is Configure SLA & routing, held by Olivia Price and Hannah Reid." },
    ],
  },
  {
    n: "4",
    title: "Score sentiment and urgency",
    when: "AI analysis · 10:46",
    kind: "ai",
    blocks: [
      { label: "In the app", text: "The same AI panel. Ticket detail repeats it under AI enrichment, and the queue shows a Negative badge." },
      { label: "Where it goes", text: "Sentiment is Negative, score −0.72, confidence 91%. Urgency signals are No heating, Child present, and Low temperature. The panel recommends Urgent for a vulnerable household with no heating." },
      { label: "Who and why", text: "The score comes from the call notes and is what recommends Urgent before staff confirm the priority." },
      { label: "Who can see it", text: "Visible on the ticket, the queue, and AI & Sentiment to anyone who can view tickets. This result is at 94% confidence, above the low-confidence review list on that page." },
    ],
  },
  {
    n: "5",
    title: "Set priority and SLA",
    when: "Ticket settings · 10:47",
    kind: "system",
    blocks: [
      { label: "In the app", text: "Ticket settings on Create ticket set priority Urgent, initial status Open, and the policy label Emergency repair · 2h. That screen puts first response due today at 12:42. At 10:47 the timeline says the system moved the SLA to At risk from the urgency policy." },
      { label: "Where it goes", text: "The SLA timer on ticket detail reads 00:42:18, At risk, 78% elapsed, due 12:42. The same row appears on the SLA exception monitor." },
      { label: "Who and why", text: "On this ticket the screen commits to a 2 hour emergency response. In SLA policy, Heating is 60 minutes to respond and 480 minutes to resolve. Urgent multiplies both by 0.25, which is 15 minutes to respond and 2 hours to resolve." },
      { label: "Who can see it", text: "The timer is on the ticket for every role with view. Editing category times and the priority multipliers is Configure SLA & routing: Olivia Price and Hannah Reid." },
    ],
  },
  {
    n: "6",
    title: "Assign primary and backup",
    when: "Allocation · system",
    kind: "system",
    blocks: [
      { label: "In the app", text: "Allocation on Create ticket is tagged System generated. Staff & Routing holds the property rule, and Next available staff ranks people with the matching skill." },
      { label: "Where it goes", text: "The Foundry, then Heating, then Dana Hughes as primary and Marcus Lee as backup. The property rule also names Ruth Allen as manager." },
      { label: "Who and why", text: "The Foundry plus Heating lists Dana, then Marcus, then Ruth. The skill rank agrees: both Dana and Marcus have Heating and are Available, and Dana’s 6 open tickets sit ahead of Marcus’s 8. Priya Shah’s skills are Access, Noise, and Safeguarding. Alex Morgan is Unavailable, with Noise and Safeguarding. If every Heating-skilled person were Unavailable, the ticket would wait on the team queue and escalation level 1 would be notified immediately." },
      { label: "Who can see it", text: "The assignee shows on the queue for every role with view. Reassign is Super Admin, Regional Admin, Type 1, and Type 2. Building the rules is Configure SLA & routing." },
    ],
  },
  {
    n: "7",
    title: "Create the ticket",
    when: "Create & assign · 10:42",
    kind: "crm",
    blocks: [
      { label: "In the app", text: "Create & assign on the create screen. The timeline’s first entry, 10:42, is CRM data: ticket created from an inbound tenant call. The id is HD-24891." },
      { label: "Where it goes", text: "Into the ticket queue. Tickets, My Queue, and Team Queue show this same sample list. The row reads Heating, Urgent, Negative, Dana Hughes, SLA 00:42, In Progress." },
      { label: "Who and why", text: "Creation follows the assignment above, so the new row is already under Dana Hughes." },
      { label: "Who can see it", text: "Every role can view the queue, and every role can create a ticket. The shell keeps My Queue on the same shared list." },
    ],
  },
  {
    n: "8",
    title: "Accept the assignment",
    when: "Ticket detail · 10:52",
    kind: "staff",
    blocks: [
      { label: "In the app", text: "Ticket detail timeline at 10:52, tagged Staff action: Dana Hughes accepted assignment. The summary status is In Progress." },
      { label: "Where it goes", text: "It stays with Dana at The Foundry. Marcus Lee remains backup. Ruth Allen remains the manager on the allocation card." },
      { label: "Who and why", text: "Dana is the primary from the Heating assignment, and she is Available." },
      { label: "Who can see it", text: "Dana sees it as the assignee. Type 3 can view and create. Marcus can view tickets and is the named backup. Olivia sees the same detail as the signed-in Super Admin." },
    ],
  },
  {
    n: "9",
    title: "Work the ticket",
    when: "Ticket detail · in progress",
    kind: "staff",
    blocks: [
      { label: "In the app", text: "Ticket detail holds the issue notes, the activity timeline, and an internal note box, plus Reassign, Escalate, Add note, and Resolve. The side column holds the SLA timer, AI enrichment, allocation, and the linked records: Maya Patel, The Foundry unit 4B, and lease L-10482 ending 30 Sep 2025." },
      { label: "Where it goes", text: "It remains In Progress with Dana while the 12:42 response deadline is still ahead. The screen shows 42 minutes left and At risk." },
      { label: "Who and why", text: "Dana is doing the work because she accepted it. Internal notes are marked visible to staff only." },
      { label: "Who can see it", text: "View is every role. Add note sits with create, which every role has. Reassign and edit sit with Super Admin, Regional Admin, Type 1, and Type 2. Delete sits with Super Admin and Regional Admin." },
    ],
  },
];

const resolve: Step = {
  n: "10",
  title: "Resolve",
  when: "Ticket detail · end of the path",
  kind: "done",
  blocks: [
    { label: "In the app", text: "The Resolve button on ticket detail." },
    { label: "Where it goes", text: "That action is the end of the path. HD-24891 is still In Progress in the queue. Resolve is available, and this ticket is still open." },
    { label: "Who and why", text: "Dana accepted at 10:52, inside the ticket’s 12:42 response due time, so the close follows the normal path once the repair is done." },
    { label: "Who can see it", text: "Olivia can use the button because the shell is hers. Edit is Super Admin, Regional Admin, Type 1, and Type 2. After a close, view still applies to every role, and delete stays with Super Admin and Regional Admin." },
  ],
};

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="rep-grid">
      {blocks.map((block) => (
        <div className="rep-block" key={block.label}>
          <small>{block.label}</small>
          <p>{block.text}</p>
        </div>
      ))}
    </div>
  );
}

function StepCard({ step, last = false }: { step: Step; last?: boolean }) {
  return (
    <article className="rep-step">
      <div className="rep-rail" aria-hidden="true">
        <i className={`rep-num rep-num-${step.kind}`}>{step.n}</i>
        {!last && <b />}
      </div>
      <section className="panel rep-card">
        <header className="rep-card-head">
          <div>
            <div className="panel-title">{step.title}</div>
            <div className="panel-subtitle">{step.when}</div>
          </div>
          <span className={`badge badge-${step.kind === "ai" ? "purple" : step.kind === "system" ? "teal" : step.kind === "staff" ? "blue" : step.kind === "done" ? "green" : "slate"}`}>
            {step.kind === "ai" ? "AI generated" : step.kind === "system" ? "System generated" : step.kind === "staff" ? "Staff action" : step.kind === "done" ? "Close" : "CRM data"}
          </span>
        </header>
        <Blocks blocks={step.blocks} />
      </section>
    </article>
  );
}

export default function TicketRep() {
  return (
    <div className="page-content rep">
      <section className="panel rep-hero">
        <div className="rep-hero-top">
          <div>
            <div className="ticket-kicker">HD-24891 · 14 Jan 2025 · Inbound call</div>
            <h2 className="rep-title">No heating — boiler failure</h2>
            <p className="rep-lead">Maya Patel · The Foundry, unit 4B · lease L-10482</p>
          </div>
          <div className="rep-now">
            <small>Where it sits now</small>
            <strong>In Progress with Dana Hughes</strong>
            <span>At risk · response due 12:42 · 00:42:18 left</span>
          </div>
        </div>
        <div className="summary-badges rep-badges">
          <span className="badge badge-blue">In Progress</span>
          <span className="badge badge-red">Urgent</span>
          <span className="badge badge-red">Negative · −0.72</span>
          <span className="badge badge-amber">At risk</span>
          <span className="badge badge-teal">Heating</span>
        </div>
        <div className="rep-route" aria-label="Assignment chain for this ticket">
          <span><small>Property</small><strong>The Foundry</strong></span>
          <i />
          <span><small>Category</small><strong>Heating</strong></span>
          <i />
          <span className="rep-route-primary"><small>Primary</small><strong>Dana Hughes</strong></span>
          <i />
          <span><small>Backup</small><strong>Marcus Lee</strong></span>
          <i />
          <span><small>Manager</small><strong>Ruth Allen</strong></span>
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <div>
            <div className="panel-title">People on this ticket</div>
            <div className="panel-subtitle">Assignment uses skill and workload. Escalation notifies roles.</div>
          </div>
        </header>
        <div className="rep-cast">
          {people.map(([name, role, detail]) => (
            <div className="rep-person" key={name}>
              <strong>{name}</strong>
              <span>{role}</span>
              <em>{detail}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel rep-gap">
        <header className="panel-header">
          <div>
            <div className="panel-title">Who can see what</div>
            <div className="panel-subtitle">From the permission matrix. Every role can view tickets. The shell stays signed in as Olivia Price, so every screen opens with Super Admin access.</div>
          </div>
        </header>
        <div className="rep-access">
          <div className="rep-access-row head">
            <span>Role</span><span>People</span><span>On HD-24891</span><span>Allowed</span>
          </div>
          {access.map((row) => (
            <div className="rep-access-row" key={row[0]}>
              <strong>{row[0]}</strong>
              <span>{row[1]}</span>
              <span>{row[2]}</span>
              <span>{row[3]}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="rep-spine">
        {steps.map((step) => <StepCard key={step.n} step={step} />)}

        <article className="rep-step">
          <div className="rep-rail" aria-hidden="true">
            <i className="rep-num rep-num-if">If</i>
            <b />
          </div>
          <section className="rep-split" aria-label="Response window branch">
            <div className="panel rep-path taken">
              <header className="rep-card-head">
                <div>
                  <div className="panel-title">Response window kept</div>
                  <div className="panel-subtitle">Path this ticket took</div>
                </div>
                <span className="badge badge-green">Taken</span>
              </header>
              <div className="rep-path-body">
                <p>Dana Hughes accepted at 10:52. The ticket screen’s first response is due at 12:42, so the Heating escalation chain did not start.</p>
                <p>The ticket stays In Progress with Dana and continues to Resolve.</p>
              </div>
            </div>
            <div className="panel rep-path missed">
              <header className="rep-card-head">
                <div>
                  <div className="panel-title">Response window missed</div>
                  <div className="panel-subtitle">Heating chain · this ticket did not enter it</div>
                </div>
                <span className="badge badge-red">Not taken</span>
              </header>
              <div className="rep-path-body">
                <p>If nobody responds, the default Heating chain starts. Urgent forces every level to notify in parallel, so everyone at that level is alerted together and the first to act closes it.</p>
                <ol className="rep-levels">
                  <li><b>1</b><span><strong>Type 2 · Priya Shah</strong><small>30 minutes, as soon as the response time is breached.</small></span></li>
                  <li><b>2</b><span><strong>Type 1 and Regional Admin</strong><small>Ruth Allen, James Cole, and Hannah Reid together. 15 minutes.</small></span></li>
                  <li><b>3</b><span><strong>Super Admin · Olivia Price</strong><small>10 minutes.</small></span></li>
                </ol>
                <p>If someone acts, the ticket goes back to being worked. If the chain ends with no action, it is flagged on the dashboard for Super Admin review. The Escalate button on ticket detail is the manual version of this branch, for roles that can edit and reassign.</p>
              </div>
            </div>
          </section>
        </article>

        <StepCard step={resolve} last />
      </div>
    </div>
  );
}
