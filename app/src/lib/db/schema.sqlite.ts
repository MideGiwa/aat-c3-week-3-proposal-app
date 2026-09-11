// The SQLite (libsql) half of this app's dual-dialect schema — used for
// local dev, or any deployment pointed at a local file/libsql URL. The
// Postgres equivalent lives right next to this in `schema.postgres.ts`.
// `schema.ts` in this folder picks between the two at runtime based on
// DATABASE_URL (see `dialect.ts`) and re-exports whichever one is active, so
// every other file in the app just imports from "@/lib/db/schema" and never
// needs to know or care which backend is actually live.
//
// Every table/column name and every exported symbol below matches the
// Postgres version exactly (see DATABASE.md at the repo root) — that's what
// makes the runtime swap in `schema.ts` transparent to the rest of the app.
// Keep the two files in sync by hand when the data model changes.
// -----------------------------------------------------------------------------

import { relations } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// --- "Enums" -----------------------------------------------------------------
// SQLite has no native enum type. drizzle-orm/sqlite-core's `text(..., {
// enum: [...] })` stores plain text but keeps the exact same TypeScript union
// type on the column, so every call site that does `row.role === "approver"`
// or similar still type-checks the same way it did against the Postgres enum.
// (The Postgres version's exported `roleEnum`/`proposalStatusEnum`/etc. objects
// themselves are only ever referenced inside that file, never imported
// elsewhere, so no re-export of those specific objects is needed here.)

const ROLE_VALUES = ["salesperson", "approver"] as const;

// "invited": provisioned by an approver, no authenticator enrolled yet —
// can't sign in. "active": has completed authenticator setup. Every
// pre-existing seeded user is "active" by default (see the column default
// below), so this migration doesn't lock anyone out.
const USER_STATUS_VALUES = ["invited", "active"] as const;

const PROPOSAL_STATUS_VALUES = [
  "draft",
  "pending_review",
  "approved",
  "changes_requested",
  "sent",
  "generation_failed",
  "document_failed",
  "send_failed",
] as const;

const SECTION_KEY_VALUES = [
  "introduction",
  "proposed_solution",
  "deliverables",
  "timeline",
  "pricing",
  "next_steps",
] as const;

const GENERATED_BY_VALUES = ["ai", "human"] as const;

const APPROVAL_DECISION_VALUES = ["approved", "rejected", "changes_requested"] as const;

const EVENT_TYPE_VALUES = [
  "proposal_created",
  "generation_started",
  "generation_succeeded",
  "generation_failed",
  "section_edited",
  "section_regenerated",
  "attachment_added",
  "submitted_for_review",
  "approved",
  "rejected",
  "changes_requested",
  "document_generated",
  "document_failed",
  "sent",
  "send_failed",
  "approval_undone",
  "ownership_changed",
] as const;

// --- Tables ------------------------------------------------------------------
// Schema follows the data model in architecture.md section 3.4, plus a `users`
// table (needed for salesperson/approver roles) and a `documents` table
// (needed for versioned PDF/HTML exports, added when PDF was made a hard
// requirement for the Document Generation Service).
//
// Postgres-only column types have SQLite equivalents chosen to keep behavior
// as close as possible:
//   uuid + defaultRandom()      -> text + $defaultFn(() => crypto.randomUUID())
//   timestamp (withTimezone)    -> integer({ mode: "timestamp" }), stored as a
//                                  unix epoch integer, converted to/from a JS
//                                  Date automatically by drizzle
//   boolean                     -> integer({ mode: "boolean" })
//   jsonb                       -> text({ mode: "json" })

export const users = sqliteTable("users", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ROLE_VALUES }).notNull().default("salesperson"),
  status: text("status", { enum: USER_STATUS_VALUES }).notNull().default("active"),
  // Set once, at authenticator setup, and never exposed again after that —
  // real sign-in verifies a submitted code against this rather than trusting
  // anything the client sends about identity.
  totpSecret: text("totp_secret"),
  // Not a declared foreign key (a self-reference on this same table would
  // need an awkward lazy-type workaround for one purely informational
  // column) — just the inviting user's id, shown on the team page.
  invitedBy: text("invited_by"),
  // Only a hash of the invite token is stored (sha256 hex) — the raw token
  // lives only in the emailed link and this request's memory, so a DB leak
  // alone can't be used to complete someone else's pending setup. Cleared
  // once the invite is used (status flips to "active") so a used/expired
  // link can't be replayed.
  inviteTokenHash: text("invite_token_hash"),
  inviteTokenExpiresAt: integer("invite_token_expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const proposals = sqliteTable("proposals", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email").notNull(),
  companyName: text("company_name").notNull(),
  dateOfCall: text("date_of_call"),
  // The original creator — permanent, never changes. Kept distinct from
  // `currentOwnerId` below so "who originally brought this in" is never
  // lost even after the proposal has changed hands several times.
  salespersonId: text("salesperson_id")
    .notNull()
    .references(() => users.id),
  // Who is actively responsible for this proposal right now, for the
  // purposes of the "Mine" default view on /proposals. Starts equal to
  // salespersonId at creation. Any salesperson can already edit any
  // proposal (no route enforces salespersonId === current user) — this
  // column doesn't add an access restriction, it just tracks who's
  // currently the one working it, updated automatically (never via a
  // manual "reassign" action) the moment a *different* salesperson takes a
  // real action on the proposal (editing/regenerating a section, uploading
  // an attachment, generating, or submitting). Every change is logged as
  // an `ownership_changed` event — see src/lib/ownership.ts — so a
  // hand-off is always auditable, not just a silent column update.
  currentOwnerId: text("current_owner_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: PROPOSAL_STATUS_VALUES }).notNull().default("draft"),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Raw intake answers, kept even after generation so regeneration/audits can
// always refer back to exactly what the salesperson originally entered.
export const intakeFields = sqliteTable("intake_fields", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(),
  fieldValue: text("field_value").notNull().default(""),
});

// Current state of each named section. Kept separate from section_versions
// so a regenerate/edit can move the "current" pointer without destroying
// history (PRD scenario 4).
export const sections = sqliteTable("sections", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  sectionKey: text("section_key", { enum: SECTION_KEY_VALUES }).notNull(),
  currentContent: text("current_content").notNull().default(""),
  needsInput: integer("needs_input", { mode: "boolean" }).notNull().default(true),
  // Points at the section_versions row `currentContent` was copied from, so
  // a generated document can record the *exact* versions it was built from
  // (architecture.md 3.6) rather than just "some version of this section".
  currentVersionId: text("current_version_id"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sectionVersions = sqliteTable("section_versions", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  sectionId: text("section_id")
    .notNull()
    .references(() => sections.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  generatedBy: text("generated_by", { enum: GENERATED_BY_VALUES }).notNull(),
  needsInput: integer("needs_input", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const attachments = sqliteTable("attachments", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  extractedText: text("extracted_text"),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const approvals = sqliteTable("approvals", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  reviewerId: text("reviewer_id")
    .notNull()
    .references(() => users.id),
  decision: text("decision", { enum: APPROVAL_DECISION_VALUES }).notNull(),
  comment: text("comment"),
  decidedAt: integer("decided_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  // Set when an approver undoes an "approved" decision before the proposal
  // is sent (architecture.md 3.5 addendum). The row is kept rather than
  // deleted — same append-only-history reasoning as section_versions/events
  // — so the fact that a proposal was briefly approved isn't erased from the
  // audit trail; every "latest approval" lookup (the send route's cc list,
  // the editor's cc preview) filters these out via `undoneAt IS NULL`.
  undoneAt: integer("undone_at", { mode: "timestamp" }),
  undoneBy: text("undone_by").references(() => users.id),
});

// Append-only audit/event log. Every component writes here on success and
// failure so the dashboard can show a specific reason instead of a stuck
// spinner (PRD scenario 7), and so "logged in a central place" is a fact,
// not just a status column.
export const events = sqliteTable("events", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: EVENT_TYPE_VALUES }).notNull(),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Generated final documents (HTML preview and/or PDF export), tied to the
// exact section versions they were built from.
export const documents = sqliteTable("documents", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  proposalId: text("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'html' | 'pdf'
  storagePath: text("storage_path").notNull(),
  sectionVersionIds: text("section_version_ids", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// --- Relations (for the drizzle query API, e.g. db.query.proposals.findMany) -

export const usersRelations = relations(users, ({ many }) => ({
  // Two distinct relations to `proposals` (created vs. currently owned) —
  // relationName on both sides disambiguates which FK each refers to.
  proposalsCreated: many(proposals, { relationName: "proposalCreator" }),
  proposalsOwned: many(proposals, { relationName: "proposalCurrentOwner" }),
  approvals: many(approvals),
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  salesperson: one(users, {
    fields: [proposals.salespersonId],
    references: [users.id],
    relationName: "proposalCreator",
  }),
  currentOwner: one(users, {
    fields: [proposals.currentOwnerId],
    references: [users.id],
    relationName: "proposalCurrentOwner",
  }),
  intakeFields: many(intakeFields),
  sections: many(sections),
  attachments: many(attachments),
  approvals: many(approvals),
  events: many(events),
  documents: many(documents),
}));

export const intakeFieldsRelations = relations(intakeFields, ({ one }) => ({
  proposal: one(proposals, {
    fields: [intakeFields.proposalId],
    references: [proposals.id],
  }),
}));

export const sectionsRelations = relations(sections, ({ one, many }) => ({
  proposal: one(proposals, {
    fields: [sections.proposalId],
    references: [proposals.id],
  }),
  versions: many(sectionVersions),
}));

export const sectionVersionsRelations = relations(sectionVersions, ({ one }) => ({
  section: one(sections, {
    fields: [sectionVersions.sectionId],
    references: [sections.id],
  }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  proposal: one(proposals, {
    fields: [attachments.proposalId],
    references: [proposals.id],
  }),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  proposal: one(proposals, {
    fields: [approvals.proposalId],
    references: [proposals.id],
  }),
  reviewer: one(users, {
    fields: [approvals.reviewerId],
    references: [users.id],
  }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  proposal: one(proposals, {
    fields: [events.proposalId],
    references: [proposals.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  proposal: one(proposals, {
    fields: [documents.proposalId],
    references: [proposals.id],
  }),
}));
