import { relations } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

// --- Enums -----------------------------------------------------------------

export const roleEnum = pgEnum("role", ["salesperson", "approver"]);

export const proposalStatusEnum = pgEnum("proposal_status", [
  "draft",
  "pending_review",
  "approved",
  "changes_requested",
  "sent",
  "generation_failed",
  "document_failed",
  "send_failed",
]);

export const sectionKeyEnum = pgEnum("section_key", [
  "introduction",
  "proposed_solution",
  "deliverables",
  "timeline",
  "pricing",
  "next_steps",
]);

export const generatedByEnum = pgEnum("generated_by", ["ai", "human"]);

export const approvalDecisionEnum = pgEnum("approval_decision", [
  "approved",
  "rejected",
  "changes_requested",
]);

export const eventTypeEnum = pgEnum("event_type", [
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
]);

// --- Tables ------------------------------------------------------------------
// Schema follows the data model in architecture.md section 3.4, plus a `users`
// table (needed for salesperson/approver roles) and a `documents` table
// (needed for versioned PDF/HTML exports, added when PDF was made a hard
// requirement for the Document Generation Service).

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("salesperson"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const proposals = pgTable("proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email").notNull(),
  companyName: text("company_name").notNull(),
  dateOfCall: text("date_of_call"),
  salespersonId: uuid("salesperson_id")
    .notNull()
    .references(() => users.id),
  status: proposalStatusEnum("status").notNull().default("draft"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Raw intake answers, kept even after generation so regeneration/audits can
// always refer back to exactly what the salesperson originally entered.
export const intakeFields = pgTable("intake_fields", {
  id: uuid("id").defaultRandom().primaryKey(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(),
  fieldValue: text("field_value").notNull().default(""),
});

// Current state of each named section. Kept separate from section_versions
// so a regenerate/edit can move the "current" pointer without destroying
// history (PRD scenario 4).
export const sections = pgTable("sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  sectionKey: sectionKeyEnum("section_key").notNull(),
  currentContent: text("current_content").notNull().default(""),
  needsInput: boolean("needs_input").notNull().default(true),
  // Points at the section_versions row `currentContent` was copied from, so
  // a generated document can record the *exact* versions it was built from
  // (architecture.md 3.6) rather than just "some version of this section".
  currentVersionId: uuid("current_version_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sectionVersions = pgTable("section_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sectionId: uuid("section_id")
    .notNull()
    .references(() => sections.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  generatedBy: generatedByEnum("generated_by").notNull(),
  needsInput: boolean("needs_input").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  extractedText: text("extracted_text"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  reviewerId: uuid("reviewer_id")
    .notNull()
    .references(() => users.id),
  decision: approvalDecisionEnum("decision").notNull(),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
});

// Append-only audit/event log. Every component writes here on success and
// failure so the dashboard can show a specific reason instead of a stuck
// spinner (PRD scenario 7), and so "logged in a central place" is a fact,
// not just a status column.
export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  eventType: eventTypeEnum("event_type").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Generated final documents (HTML preview and/or PDF export), tied to the
// exact section versions they were built from.
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'html' | 'pdf'
  storagePath: text("storage_path").notNull(),
  sectionVersionIds: jsonb("section_version_ids").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
