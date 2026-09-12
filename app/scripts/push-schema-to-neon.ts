// Runs `drizzle-kit push` against Neon specifically, regardless of what
// DATABASE_URL is currently set to locally (normally the local SQLite file).
// A plain `pnpm run db:push` always follows DATABASE_URL (see
// drizzle.config.ts), which is exactly what you want day to day — this
// script exists for the one case where you need to push against Neon
// *without* changing DATABASE_URL at all, e.g. to bring Neon's schema up to
// date before running scripts/migrate-sqlite-to-postgres.ts.
//
// Deliberately spawns `drizzle-kit push` as a child process with
// DATABASE_URL overridden in *that process's* environment only — this is
// the reliable cross-shell way to do that (setting an env var inline before
// a command uses different, easy-to-get-wrong syntax in PowerShell vs.
// cmd.exe vs. bash, and none of it touches your actual .env file).
//
// Usage:
//   pnpm run db:push:neon
import "dotenv/config";
import { spawnSync } from "node:child_process";

const neonUrl = process.env.NEON_DATABASE_URL;
if (!neonUrl) {
  console.error("NEON_DATABASE_URL is not set — add it to .env first.");
  process.exit(1);
}

console.log("Pushing the Postgres schema to Neon (DATABASE_URL overridden for this command only)...\n");

const result = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: neonUrl },
});

process.exit(result.status ?? 1);
