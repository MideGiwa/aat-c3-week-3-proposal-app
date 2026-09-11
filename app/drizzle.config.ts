// --- TEMPORARY SQLITE SWAP -------------------------------------------------
// This file normally targets Postgres. It has been temporarily replaced to
// target the local SQLite file instead, so `db:push`/`db:studio` work against
// `local-dev.sqlite` while Neon is unreachable. The original is preserved
// untouched at `drizzle.config.postgres.bak.ts`. See `TEMP-SQLITE-SETUP.md`
// at the repo root for setup + revert steps.
// -----------------------------------------------------------------------------
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./local-dev.sqlite",
  },
  verbose: true,
  strict: true,
});
