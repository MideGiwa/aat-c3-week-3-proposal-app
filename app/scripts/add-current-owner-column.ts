// One-off migration for the new proposal-ownership feature.
//
// `proposals` gains a `current_owner_id` column (see src/lib/db/schema.ts)
// tracking who's currently responsible for a proposal, separate from
// `salesperson_id` (the original creator) — this is what the "Mine"/"All"
// toggle on /proposals filters by, and what updates automatically (logged
// as an `ownership_changed` event) when a different salesperson picks up
// someone else's proposal.
//
// Run once, locally, against local-dev.sqlite:
//   pnpm exec tsx scripts/add-current-owner-column.ts
//
// Safe to run more than once — it checks whether the column already exists
// first and does nothing if so.
import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.DATABASE_URL || "file:./local-dev.sqlite";
  const client = createClient({ url });

  const info = await client.execute("PRAGMA table_info(proposals)");
  const alreadyHasColumn = info.rows.some((row) => row.name === "current_owner_id");

  if (alreadyHasColumn) {
    console.log("current_owner_id already exists on proposals — nothing to do.");
    return;
  }

  // SQLite won't let ALTER TABLE ADD COLUMN combine a REFERENCES clause
  // with a non-null DEFAULT, so this is added as a plain TEXT NOT NULL
  // column (the REFERENCES users(id) in schema.ts is a Drizzle-level
  // declaration, not a runtime constraint SQLite enforces here regardless).
  await client.execute("ALTER TABLE proposals ADD COLUMN current_owner_id TEXT NOT NULL DEFAULT ''");
  // Backfill: every existing proposal's current owner starts as whoever
  // created it.
  await client.execute("UPDATE proposals SET current_owner_id = salesperson_id");

  console.log("Added current_owner_id and backfilled it from salesperson_id.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
