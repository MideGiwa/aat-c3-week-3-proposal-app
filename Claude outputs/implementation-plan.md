# Implementation Plan: AI Proposal Document Application

This breaks the architecture in `architecture.md` into buildable phases and concrete tasks. Phases are ordered by dependency, not by priority — a phase generally can't start meaningfully until the one before it has working (even if rough) output, since each phase builds on data or endpoints the previous one created. Within a phase, frontend and backend tasks can usually run in parallel once the API contract for that phase is settled.

## Phase 0 — Project setup & scaffolding

Goal: an empty but deployable skeleton, so every later phase ships into something already live rather than integrating at the end.

- [ ] Initialize the repo (Next.js app, or your chosen frontend+API split) and get a "hello world" deploy working on Vercel (or your host of choice).
- [ ] Provision Postgres (Supabase/Neon) and wire up the ORM (Prisma) with a connection from the deployed app.
- [ ] Store the Anthropic API key and any other secrets (email provider key, DB URL) as environment variables, not in code.
- [ ] Seed a minimal set of internal users with a role field (`salesperson` / `approver`) — full auth can be simple (hardcoded users, magic link, or basic email/password) since this is an internal tool.
- [ ] Set up the base page shell/navigation so later phases only add screens, not routing infrastructure.

## Phase 1 — Data model & intake

Goal: a salesperson can submit a complete intake and it lands in the database. No AI yet.

- [ ] Write migrations for `proposals`, `intake_fields`, `sections`, `section_versions`, `attachments`, `approvals`, `events` (schema from `architecture.md` §3.4).
- [ ] Build the intake form UI from `intake-form-fields.md`, marking required vs. optional fields visibly.
- [ ] Add file upload for supporting material, storing files (e.g., object storage or a simple uploads table) and linking them to `attachments`.
- [ ] Implement `POST /proposals`: validate the intake payload against required fields, reject incomplete submissions with a clear error, and persist a `proposals` row plus its `intake_fields`.
- [ ] Write a first `events` entry (`proposal_created`) so the audit trail starts at creation, not later.

*Maps to: groundwork for PRD scenario 1; the required-field check is the first line of defense for scenario 2.*

## Phase 2 — AI generation (core loop)

Goal: a submitted intake produces a full draft proposal with named sections.

- [ ] Build the AI Generation Service wrapper around the Anthropic SDK (isolated from route handlers, per `architecture.md` §3.3).
- [ ] Construct the generation prompt from the intake fields plus the structure in `proposal-template.md`, asking for output as discrete named sections (introduction, proposed solution, deliverables, timeline, pricing, next steps).
- [ ] Instruct the model explicitly not to invent missing specifics, and instead emit a placeholder (e.g. `[NEEDS INPUT: ...]`) — then parse the response for these markers and set `needs_input` per section.
- [ ] Extract text from uploaded attachments and include it as generation context; instruct the model to reference it concretely.
- [ ] Implement `POST /proposals/:id/generate`, persist each section into `sections` + a first row in `section_versions` (`generated_by = 'ai'`), and write a `generation_succeeded` or `generation_failed` event.
- [ ] Add basic retry/backoff and error classification (rate limit, timeout, malformed response) so a transient failure doesn't need a manual retry from scratch.

*Maps to: PRD scenarios 1, 2, and 3 directly — this phase is the one to test hardest against those three before moving on.*

## Phase 3 — Review, edit & regeneration

Goal: the salesperson can read the draft, edit it, and regenerate a single section without disturbing the rest.

- [ ] Build the editor screen rendering each section independently, with `needs_input` sections visibly flagged.
- [ ] Implement `PATCH /proposals/:id/sections/:sectionId` for manual edits, writing a new `section_versions` row (`generated_by = 'human'`).
- [ ] Implement `POST /proposals/:id/sections/:sectionId/regenerate`, calling the AI service scoped to that section with the other sections passed as fixed context, and writing a new AI-generated version.
- [ ] Add a version indicator or simple diff view so it's visible when a section was last changed and by what (human edit vs. regeneration).
- [ ] Confirm regenerating one section leaves every other section's current content and version history untouched (this is the specific behavior PRD scenario 4 tests).

*Maps to: PRD scenario 4.*

## Phase 4 — Approval workflow

Goal: a proposal cannot reach "sendable" without an explicit internal approval, enforced by the server.

- [ ] Implement the status state machine on `proposals` (`draft` → `pending_review` → `approved`/`changes_requested` → `sent`, plus the `*_failed` states).
- [ ] Implement `POST /proposals/:id/submit`, blocking the transition if any section is still `needs_input`.
- [ ] Build the approval screen, reachable only by the `approver` role, showing the full proposal read-only with approve/reject/request-changes actions.
- [ ] Implement `POST /proposals/:id/approve`, `/reject`, writing to `approvals` and `events`; a `changes_requested` decision should route back to the editor with the reviewer's comment attached rather than resetting anything.
- [ ] Add the server-side guard on the (not-yet-built) send endpoint now, as a stub check, so Phase 6 has nothing to retrofit: reject any send attempt where `status != 'approved'`.

*Maps to: PRD scenario 5 — the server-side check is the part that actually satisfies it, not the UI hiding a button.*

## Phase 5 — Document generation (PDF)

Goal: an approved proposal can be rendered into the actual client-facing document.

- [ ] Build the shared HTML template (used for both the in-app preview and the PDF source) from `proposal-template.md`.
- [ ] Add headless PDF rendering (e.g. Puppeteer) that prints that HTML to PDF.
- [ ] Store each generated PDF, tied to the exact `section_versions` it was built from, so "the document that was approved" is traceable and reproducible.
- [ ] Handle rendering failures by moving the proposal to `document_failed` with a specific reason in `events`.
- [ ] Regenerate the document on demand (not cached) whenever a later edit changes the underlying sections, so what gets sent always matches what was last approved.

*Maps to: PRD scenario 6 (the document half), and the "generated proposal sample" deliverable.*

## Phase 6 — Delivery & central logging

Goal: an approved proposal can actually be sent to the client, and every proposal's status is visible in one place.

- [ ] Integrate the email provider (Resend or similar) and compose the message from `client-email-template.md`, substituting in the client's name, company, salesperson, and the link to the stored PDF.
- [ ] Implement `POST /proposals/:id/send`, re-checking `status = 'approved'` server-side, then writing a `sent` event (recipient, timestamp, document version) and flipping status to `sent`.
- [ ] On send failure (bad address, provider error, timeout), move to `send_failed` and capture the provider's error verbatim in `events`.
- [ ] Build the dashboard (`GET /proposals` + list UI) showing every proposal's status, and expose a retry action for any `send_failed` (or `generation_failed`/`document_failed`) proposal.

*Maps to: PRD scenario 6 (delivery + logging half) — this is also the "central place" the PRD asks for.*

## Phase 7 — Failure handling pass

Goal: deliberately verify that every failure mode is visible and debuggable, not just handled in theory.

- [ ] Audit that all four risk points (generation, document build, approval, send) write to `events` on both success and failure with enough detail to reconstruct what happened.
- [ ] Confirm the dashboard surfaces the failure reason in plain language, not a raw stack trace or a silent stuck state.
- [ ] Manually trigger each failure mode once — force a Claude API error (e.g. bad API key temporarily), force a PDF render error (malformed template data), force an email send error (invalid address) — and confirm each produces a visible, specific failure state.

*Maps to: PRD scenario 7 — this phase exists because failure handling is easy to claim and easy to leave partially wired; testing it deliberately is the only way to know it's actually done.*

## Phase 8 — Testing & submission deliverables

Goal: package the working application into what the PRD asks you to submit.

- [ ] Run all 7 PRD test scenarios end-to-end and fill in the testing evidence table.
- [ ] Generate one complete sample proposal (ideally one that exercises supporting material and at least one regeneration) to submit as the sample.
- [ ] Record the Loom walkthrough covering intake → generation → edit/regenerate → approval → send → dashboard.
- [ ] Write the one-page documentation (this can draw directly from `architecture.md`, condensed to one page).
- [ ] Complete the reflection sheet.
- [ ] Confirm the application link is live and reachable before submitting.

## Suggested sequencing

Phases 0–1 are strictly sequential groundwork. Phase 2 depends on Phase 1's schema and intake endpoint existing. Phases 3 and 4 can overlap somewhat — the approval state machine (4) doesn't need the regeneration UI (3) finished, just the underlying section data from Phase 2 — but both should land before Phase 5, since Document Generation needs a stable, approved set of sections to render. Phase 6 depends on Phase 5 (there's nothing to email without a generated document) and on Phase 4's approval gate already being enforced. Phase 7 is a cross-cutting check best done once 1–6 exist, rather than perfected incrementally inside each phase — trying to fully solve failure handling per-phase tends to slow everything else down before there's anything working end-to-end to test failures against. Phase 8 only starts once Phase 7 has confirmed the failure paths are real, since the testing evidence table asks for exactly that.
