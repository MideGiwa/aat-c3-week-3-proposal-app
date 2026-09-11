// Dispatches to the SQLite (`schema.sqlite.ts`) or Postgres
// (`schema.postgres.ts`) table/relation definitions based on DATABASE_URL,
// so the rest of the app (every route, plus auth.ts, seed.ts,
// ownership.ts, ...) can keep importing table objects from
// "@/lib/db/schema" without knowing or caring which backend is live. See
// `src/lib/db/index.ts` for the matching driver/client dispatch, and
// DATABASE.md at the repo root for the full picture.
//
// Both dialect-specific modules below are plain, side-effect-free
// table/relation declarations — importing a schema file never opens a
// connection, only `index.ts`'s `createClient`/`Pool` calls do — so
// statically importing both here and picking one at runtime is safe: the
// half that isn't active is simply never touched.
import * as sqliteSchema from "./schema.sqlite";
import * as postgresSchema from "./schema.postgres";
import { isPostgresUrl } from "./dialect";

const active = isPostgresUrl(process.env.DATABASE_URL) ? postgresSchema : sqliteSchema;

// Every export below is asserted to the SQLite variant's type, matching the
// same convenience assertion `db` gets in index.ts: the two schemas are
// kept field-for-field identical (see DATABASE.md), so call sites that need
// an *exact* column type — not just a dialect-agnostic SQL fragment, e.g.
// `onConflictDoUpdate({ target: users.email })` — still type-check, against
// one consistent (SQLite) shape, regardless of which dialect is actually
// live. At runtime each export is genuinely whichever dialect's real table
// object `active` resolved to above; only the declared TypeScript type is
// fixed.
export const users = active.users as typeof sqliteSchema.users;
export const proposals = active.proposals as typeof sqliteSchema.proposals;
export const intakeFields = active.intakeFields as typeof sqliteSchema.intakeFields;
export const sections = active.sections as typeof sqliteSchema.sections;
export const sectionVersions = active.sectionVersions as typeof sqliteSchema.sectionVersions;
export const attachments = active.attachments as typeof sqliteSchema.attachments;
export const approvals = active.approvals as typeof sqliteSchema.approvals;
export const events = active.events as typeof sqliteSchema.events;
export const documents = active.documents as typeof sqliteSchema.documents;

export const usersRelations = active.usersRelations as typeof sqliteSchema.usersRelations;
export const proposalsRelations = active.proposalsRelations as typeof sqliteSchema.proposalsRelations;
export const intakeFieldsRelations = active.intakeFieldsRelations as typeof sqliteSchema.intakeFieldsRelations;
export const sectionsRelations = active.sectionsRelations as typeof sqliteSchema.sectionsRelations;
export const sectionVersionsRelations = active.sectionVersionsRelations as typeof sqliteSchema.sectionVersionsRelations;
export const attachmentsRelations = active.attachmentsRelations as typeof sqliteSchema.attachmentsRelations;
export const approvalsRelations = active.approvalsRelations as typeof sqliteSchema.approvalsRelations;
export const eventsRelations = active.eventsRelations as typeof sqliteSchema.eventsRelations;
export const documentsRelations = active.documentsRelations as typeof sqliteSchema.documentsRelations;
