# Architecture: AI Proposal Document Application

## 1. Objective, restated from the PRD

The sales team currently writes client proposals by hand after discovery calls, pulling from notes, old proposals, and internal templates. That process is slow and inconsistent. The system to build is a small web application that takes structured call/project inputs, uses the Claude API to draft proposal content, lets a salesperson review and revise that draft, produces a final client-ready document, routes it through an internal approval step before anything reaches the client, and keeps a central record of every proposal and its status.

Two things shape every decision below. First, the brief calls for a "small web application," not a distributed system, so the design favors the simplest stack that can be built and demoed within the project timeline over one that scales to many teams. Second, the seven testing scenarios in the PRD (normal generation, missing information, supporting material, section regeneration, human approval, delivery and logging, failure handling) are treated as the actual functional spec — every component below exists because at least one of those scenarios requires it.

## 2. High-level architecture

The application is a single web app with one backend, one database, and one external dependency (the Claude API) plus one delivery dependency (an email provider). There is no need for queues, microservices, or a separate AI service — a monolith with clear internal boundaries is the right shape here.

```
                         ┌─────────────────────────────┐
                         │   Client Web Application      │
                         │ (intake form, editor, review,  │
                         │  approval screen, dashboard)   │
                         └───────────────┬────────────────┘
                                          │ HTTPS / REST
                         ┌───────────────▼────────────────┐
                         │     Backend API / Orchestrator   │
                         │  (validation, state machine,     │
                         │   routes requests to services)   │
                         └──┬───────────┬────────────┬─────┘
                            │           │            │
             ┌──────────────▼──┐ ┌──────▼──────┐ ┌───▼─────────────┐
             │ AI Generation    │ │ Document    │ │ Delivery &        │
             │ Service          │ │ Generation  │ │ Logging Service   │
             │ (Claude wrapper) │ │ Service     │ │ (email + audit)   │
             └──────────────────┘ └─────────────┘ └───────────────────┘
                            │           │            │
                         ┌──▼───────────▼────────────▼─────┐
                         │        Proposal Data Store         │
                         │ (proposals, sections, versions,    │
                         │  approvals, attachments, events)   │
                         └─────────────────────────────────────┘
```

The Approval Workflow is not drawn as a separate box because it is not a separate service — it is a state machine that lives in the Backend API and is enforced against the Data Store. It gets its own section below because the PRD calls it out as a hard requirement (nothing reaches the client without it), and because "hard requirement" needs to translate into an actual technical control, not just a UI step.

## 3. Core components

### 3.1 Client Web Application (frontend)

This is the salesperson-facing surface and covers four screens: an intake form matching the fields in `intake-form-fields.md`, a proposal editor/review screen showing the generated draft section by section, an approval screen for the internal reviewer, and a dashboard listing every proposal with its status (the "central place" the PRD asks for, viewed rather than stored here).

Technical requirements: the intake form must mark which fields are required versus optional and must accept file uploads for supporting material (call recordings' notes, prior contracts, decks) since PRD scenario 3 depends on that material reaching the generator. The editor must render the proposal as independently editable sections, each with its own "Regenerate this section" action and a visible diff or version indicator, so scenario 4 (regenerate one section without losing the rest) is a UI-level guarantee, not just a backend possibility. The approval screen must only be reachable by a reviewer role and must not expose a "send to client" action until a proposal is in an approved state, enforced again server-side so the UI restriction is not the only line of defense. The dashboard must surface status (draft, in review, approved, sent, failed) and the failure reason for any proposal in a failed state, directly addressing scenario 7.

Recommended implementation: a React frontend, most simply as part of a Next.js app so frontend and backend ship from one repository — appropriate for a small team and a short build window.

### 3.2 Backend API / Orchestration service

This is the only component that talks to every other component and the only place business rules are enforced, which matters because the frontend cannot be trusted to be the sole enforcer of the approval gate or of data validation.

Its endpoints break down by function: proposal creation from intake (`POST /proposals`), full or per-section generation (`POST /proposals/:id/generate`, `POST /proposals/:id/sections/:sectionId/regenerate`), edits saved by the salesperson (`PATCH /proposals/:id/sections/:sectionId`), submission for approval (`POST /proposals/:id/submit`), the approval decision itself (`POST /proposals/:id/approve` / `/reject`), final send (`POST /proposals/:id/send`), and read endpoints for the dashboard and individual proposal history (`GET /proposals`, `GET /proposals/:id`).

Technical requirements: request validation must check the intake payload against the required fields before calling Claude at all, so obviously incomplete input is rejected early rather than silently generating a proposal with fabricated details. The `/send` endpoint must check proposal status server-side and return an error (not just a UI-hidden button) if the proposal is not in an approved state — this is the actual enforcement point for PRD scenario 5. Every state transition (submitted, approved, rejected, sent, failed) must be written to an append-only events/audit table rather than only updating a status column, so the history of who did what and when is reconstructable later, which both satisfies "logs the proposal in a central place" and gives scenario 7 something concrete to inspect when something fails.

### 3.3 AI Generation Service (Claude integration layer)

This is a thin wrapper around the Anthropic API, isolated behind an interface so prompt construction, retries, and response parsing live in one place rather than scattered through route handlers.

Technical requirements map directly to three of the seven test scenarios. For normal generation (scenario 1), the service builds a structured prompt from the intake fields plus the reference structure in `proposal-template.md`, and asks Claude to return the proposal as discrete named sections (JSON or clearly delimited blocks: introduction, proposed solution, deliverables, timeline, pricing, next steps) rather than one undifferentiated block of text, because independent sections are what makes regeneration and review-by-section possible downstream. For missing information (scenario 2), the prompt must explicitly instruct the model not to invent specifics it wasn't given, and instead to emit a visible placeholder such as `[NEEDS INPUT: pricing not provided on intake]` for any field that was blank or a section that depends on missing context; the backend then scans the returned sections for these markers and flags the proposal as "needs input" rather than "ready for review" so a gap can't quietly slip through to approval. For supporting material (scenario 3), any uploaded files are extracted to text server-side (or passed as native document input if the model call supports it) and included as additional context in the same generation call, and the prompt asks the model to reference that material concretely (naming a deliverable or detail from it) rather than ignoring it — this is also the easiest scenario to verify in testing, since the sample proposal should visibly cite something only present in the uploaded material. Regeneration (scenario 4) is a call to this same service scoped to one section, passing the other approved sections as fixed context so tone and facts stay consistent, and returning only the replacement for that one section; the backend then swaps that section in place, leaving the rest of the stored proposal untouched.

This service must also handle and classify its own failures — rate limits, timeouts, malformed responses — into a small set of error codes the backend can act on (retry once, then mark the section or proposal as generation-failed with a human-readable reason), which is what scenario 7 requires for this component specifically.

### 3.4 Proposal Data Store

Everything durable lives here: the intake data, the generated content, every edit and regeneration, the approval decision, and the delivery record. A relational database is the right choice given how relational this data actually is (a proposal has many sections, which have many versions; a proposal has zero or one approval record; a proposal has zero or more attachments and events).

Minimum schema:

| Table | Key fields | Purpose |
| --- | --- | --- |
| `users` | id, name, email, role ('salesperson'/'approver') | The small internal team; role drives who can approve vs. who owns a proposal |
| `proposals` | id, client_name, client_email, company_name, salesperson_id, status, last_error, created_at | One row per proposal; status drives what actions are currently valid |
| `intake_fields` | proposal_id, field_key, field_value | The raw intake answers, kept even after generation so regeneration and audits can reference the original input |
| `sections` | id, proposal_id, section_key, current_content, needs_input (bool), current_version_id | Current state of each named section (introduction, scope, deliverables, timeline, pricing, next steps); `current_version_id` points at the exact `section_versions` row it was copied from |
| `section_versions` | id, section_id, content, generated_by ('ai'/'human'), created_at | Full history of every generation and manual edit per section, so nothing is destructively overwritten |
| `attachments` | id, proposal_id, filename, extracted_text, uploaded_at | Supporting material and what was extracted from it for generation |
| `approvals` | id, proposal_id, reviewer_id, decision, comment, decided_at | The internal approval record required before send |
| `events` | id, proposal_id, event_type, detail, created_at | Append-only log of every transition and every failure, across all components |
| `documents` | id, proposal_id, kind ('pdf'), storage_path, section_version_ids (json), created_at | Each generated document, tied to the exact section versions it was built from |

Technical requirements: `sections` and `section_versions` must be separate tables, not one, because regeneration (scenario 4) needs to replace the current pointer without deleting history, and because "revise without losing the rest" implies the rest of the row set is untouched by a single-section write. The `events` table is what turns "make failures debuggable" (scenario 7) from an intention into a queryable fact — every component (generation, document build, send, approval) writes here on both success and failure with enough detail (which proposal, which step, what error) to reconstruct what happened without reading server logs.

### 3.5 Approval Workflow

Modeled as an explicit status enum on `proposals` rather than a boolean flag, because there are more than two states to distinguish: `draft` → `pending_review` → `approved` or `changes_requested` → (once approved) `sent`, with `generation_failed`, `document_failed`, and `send_failed` as terminal-but-recoverable states reachable from the relevant step.

Technical requirements: the transition to `pending_review` should be blocked if any section is still flagged `needs_input`, so an incomplete proposal cannot be pushed to a reviewer as if it were finished — this connects the missing-information handling in 3.3 directly to the approval gate rather than leaving it as a cosmetic warning. The transition from `pending_review` to `sent` must go through `approved` and nowhere else; the send endpoint (3.2) checks this status directly rather than trusting that the UI only showed the send button after approval, since server-side enforcement is the only version of this control that actually satisfies scenario 5. A `changes_requested` decision should route back to the editor with the reviewer's comment attached, not reset the proposal, so the salesperson isn't starting over.

### 3.6 Document Generation Service

Converts the current set of sections into the client-facing document, following the structure in `proposal-template.md`.

Technical requirements: generation must be re-run on demand from the current section content rather than cached indefinitely — specifically, unconditionally at send time — so an edit made after approval is still reflected in the document a client actually receives, not an earlier preview. The original plan here was to render one HTML template and print it to PDF headlessly (e.g. via Puppeteer), sharing that template with the in-app preview so the two could never drift apart. **As built, PDF generation uses `pdfkit`** (a pure JS/TS PDF writer) instead: it renders the same section data directly to PDF with no browser involved, which avoids shipping or downloading a Chromium binary — a real cost on serverless hosts, and one that was also blocked outright in the sandbox this was built in. The "shared source of truth" goal is preserved even though the mechanism changed: the in-app editor and the PDF both render from the exact same `sections`/`section_versions` data, so they can't disagree about content, even if pdfkit's visual fidelity to a styled HTML preview is lower than a browser-rendered PDF would be. Each PDF export must be stored and versioned like any other generated artifact — tied to the section versions it was built from via `documents.section_version_ids` — so the document that was actually approved is traceable, and `{{proposal_link}}` in the client email can point at that stored PDF (or a route that serves it) rather than a live-rendered view that could change after approval. Failures here (a rendering error, incomplete section content at generation time) must move the proposal to `document_failed` and write a specific reason to `events`, per scenario 7.

### 3.7 Delivery & Logging Service

Handles the one outbound action that actually leaves the system — sending the approved proposal to the client — and is the last point at which "logged in a central place" is made concrete.

Technical requirements: sending should compose the email from `client-email-template.md`, substituting in the generated document's link, and should only be callable when `proposals.status = 'approved'` (re-checked here, not assumed from the caller) — or retrying from `send_failed`. **The provider that actually delivers the email is a runtime switch, not a fixed choice**: the default is a direct API call to Resend, but the same interface can instead hand the message off to an n8n webhook (`to`, `subject`, `html`, `text`, and the proposal/client fields, POSTed as JSON), letting an n8n workflow do the actual sending — useful for a team that already routes outbound email through n8n, or wants sending to go through something they can inspect and change without a code deploy. Nothing else in the system needs to know or care which provider is active; the switch is one environment variable. On successful send (either provider), the service writes a `sent` event with recipient, timestamp, provider, and the document version that was actually sent — not just "a document" but which version, since content can have changed across regenerations — and flips the proposal to `sent`, which is what makes it appear correctly on the dashboard (3.1) as delivered rather than merely approved. On failure (bad address, provider error, timeout, an unreachable n8n webhook), the proposal moves to `send_failed` with the provider's error captured verbatim in `events`, and the dashboard must expose a retry action rather than leaving the salesperson to guess whether the client received anything — this is the scenario 7 requirement that has the most real-world consequence if skipped, since a silent send failure means a client never hears back at all.

## 4. Suggested stack

Given the small-application scope and a short build window, the pragmatic choice is a single Next.js application (React frontend and API routes in one deployable), PostgreSQL as the database (a hosted free tier such as Supabase or Neon avoids standing up infrastructure) accessed through an ORM for the schema in 3.4, the official Anthropic SDK for the generation service, a PDF library for the document output, and a transactional email provider (or a workflow-tool webhook) for delivery. Authentication can be minimal — a small, fixed set of internal users with a role field (`salesperson` / `approver`) is enough to satisfy the approval-gate requirement without building a full identity system.

**As built**, the specific choices are: **Drizzle ORM** rather than Prisma (Prisma's engine binaries require a binary download at `prisma generate` time, which failed in the build sandbox; Drizzle is pure TypeScript with no native binary, which also tends to be more portable across serverless hosts); **pdfkit** rather than a headless-Chromium PDF pipeline (see 3.6); and **Resend, with n8n as a switchable alternative**, for delivery (see 3.7). None of these are load-bearing architectural decisions — a team could swap any of them back without touching the data model or the API surface, which is exactly why the interfaces in 3.3/3.6/3.7 were kept thin. Note also that if the database is Supabase specifically, the ORM connection needs Supabase's actual Postgres connection string (with a database password) — the project's URL and publishable/anon key are for Supabase's own client libraries (Auth, Storage, REST), a separate thing that this data layer doesn't use.

This whole stack deploys as one Vercel project plus one hosted Postgres instance, which keeps operational overhead near zero, appropriate for a project of this scope — with the caveat that the local-disk document storage described in 3.6 needs to move to object storage (S3/R2/Supabase Storage) before a serverless deploy, since that filesystem doesn't persist between invocations there.

## 5. PRD test scenarios mapped to components

| Scenario | Primarily exercised by |
| --- | --- |
| 1. Normal proposal generation | Client App (intake) → Backend → AI Generation Service → Document Generation |
| 2. Missing information | AI Generation Service (placeholder markers) → Backend (needs_input flag) → Approval Workflow (blocks submission) |
| 3. Supporting material | Client App (upload) → AI Generation Service (extraction + context) |
| 4. Section regeneration | Client App (editor) → Backend → AI Generation Service → Data Store (`section_versions`) |
| 5. Human approval | Approval Workflow → Backend (`/send` server-side check) |
| 6. Final delivery and logging | Document Generation → Delivery & Logging Service → Data Store (`events`) |
| 7. Failure handling | Every component writes to `events` with a specific status and reason; Client App dashboard surfaces it |

## 6. What to revisit if this grows beyond a course project

This design assumes one organization, a handful of internal users, and proposal volume low enough that synchronous Claude calls and synchronous PDF rendering (rather than a background job queue) are acceptable latency-wise. If usage grew, the first things to change would be moving generation and document rendering to background jobs so the UI doesn't block on a multi-second Claude call, adding real authentication/SSO in place of the placeholder sign-in, and moving document storage off local disk (necessary for any serverless or multi-instance deploy regardless of scale). None of that is needed to satisfy the current PRD.
