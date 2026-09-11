// --- TEMPORARY SQLITE SWAP -------------------------------------------------
// This file normally defines the Postgres schema (drizzle-orm/pg-core). It has
// been temporarily replaced with a SQLite-flavored equivalent so the app can
// run against a local file while Neon is unreachable over this network. The
// original Postgres version is preserved untouched at `schema.postgres.bak.ts`
// in this same folder. See `TEMP-SQLITE-SETUP.md` at the repo root for how
// this was set up and exactly how to revert it once Neon is reachable again.
//
// Every table/column name and every exported symbol below matches the
// Postgres version exactly, so no other file in the app (routes, auth.ts,
// seed.ts, etc.) needed to change to support this swap.
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
  salespersonId: text("salesperson_id")
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
  proposals: many(proposals),
  approvals: many(approvals),
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  salesperson: one(users, {
    fields: [proposals.salespersonId],
    references: [users.id],
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
