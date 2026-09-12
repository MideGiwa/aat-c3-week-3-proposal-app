// One-off data migration: copies every row out of the local SQLite database
// this app has been using for dev and writes it into a real Postgres
// database (Neon), preserving ids exactly so foreign keys still line up on
// the other side. Unlike `db:push` (which only creates/alters *tables*),
// this moves actual *rows* — for a first migration off SQLite once Neon is
// reachable and its tables already exist (run `db:push` against it first
// if they don't).
//
// Reads via the SQLite schema/driver and writes via the Postgres
// schema/driver directly (not through src/lib/db/index.ts's dispatcher,
// which only ever picks one side) so every value drizzle already knows how
// to convert per dialect — timestamps, booleans, the documents table's
// JSON column — round-trips correctly without any manual conversion here.
//
// Idempotent: every insert is `ON CONFLICT DO NOTHING`, so re-running this
// after a partial run (or after Neon already has some of this data) only
// inserts what's missing rather than erroring or duplicating rows.
//
// Usage:
//   pnpm exec tsx scripts/migrate-sqlite-to-postgres.ts
//
// Reads the source SQLite file from SQLITE_SOURCE_URL (defaults to
// file:./local-dev.sqlite) and writes to NEON_DATABASE_URL — both env vars,
// loaded from .env like the rest of this app. Deliberately does not use
// DATABASE_URL for either side: this script always means "SQLite ->
// Postgres" regardless of which one DATABASE_URL currently points the app
// itself at.
import "dotenv/config";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as sqliteSchema from "../src/lib/db/schema.sqlite";
import * as pgSchema from "../src/lib/db/schema.postgres";

async function main() {
  const sqliteUrl = process.env.SQLITE_SOURCE_URL || "file:./local-dev.sqlite";
  const neonUrl = process.env.NEON_DATABASE_URL;
  if (!neonUrl) {
    throw new Error("NEON_DATABASE_URL is not set — add it to .env first.");
  }

  console.log(`Source (SQLite): ${sqliteUrl}`);
  console.log(`Destination (Postgres): ${neonUrl.replace(/:\/\/[^@]+@/, "://***@")}`);

  const sqliteDb = drizzleLibsql(createClient({ url: sqliteUrl }), { schema: sqliteSchema });
  const pgPool = new Pool({ connectionString: neonUrl });
  const pgDb = drizzlePg(pgPool, { schema: pgSchema });

  // Parent-before-child order — required for the inserts below to satisfy
  // foreign keys on the Postgres side (SQLite never enforced these the same
  // way, so the source data's own row order can't be relied on).
  const users = await sqliteDb.select().from(sqliteSchema.users);
  const proposals = await sqliteDb.select().from(sqliteSchema.proposals);
  const intakeFields = await sqliteDb.select().from(sqliteSchema.intakeFields);
  const sections = await sqliteDb.select().from(sqliteSchema.sections);
  const sectionVersions = await sqliteDb.select().from(sqliteSchema.sectionVersions);
  const attachments = await sqliteDb.select().from(sqliteSchema.attachments);
  const approvals = await sqliteDb.select().from(sqliteSchema.approvals);
  const events = await sqliteDb.select().from(sqliteSchema.events);
  const documents = await sqliteDb.select().from(sqliteSchema.documents);

  console.log("\nRead from SQLite:");
  console.log(`  users=${users.length} proposals=${proposals.length} intakeFields=${intakeFields.length}`);
  console.log(`  sections=${sections.length} sectionVersions=${sectionVersions.length} attachments=${attachments.length}`);
  console.log(`  approvals=${approvals.length} events=${events.length} documents=${documents.length}`);

  async function copy<T extends Record<string, unknown>>(
    label: string,
    table: Parameters<typeof pgDb.insert>[0],
    rows: T[]
  ) {
    if (rows.length === 0) {
      console.log(`  ${label}: nothing to copy`);
      return;
    }
    const result = await pgDb.insert(table).values(rows).onConflictDoNothing().returning();
    const skipped = rows.length - result.length;
    console.log(`  ${label}: inserted ${result.length}${skipped ? `, skipped ${skipped} (already present)` : ""}`);
  }

  console.log("\nWriting to Postgres (parent tables first):");
  await copy("users", pgSchema.users, users);
  await copy("proposals", pgSchema.proposals, proposals);
  await copy("intake_fields", pgSchema.intakeFields, intakeFields);
  await copy("sections", pgSchema.sections, sections);
  await copy("section_versions", pgSchema.sectionVersions, sectionVersions);
  await copy("attachments", pgSchema.attachments, attachments);
  await copy("approvals", pgSchema.approvals, approvals);
  await copy("events", pgSchema.events, events);
  await copy("documents", pgSchema.documents, documents);

  await pgPool.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
