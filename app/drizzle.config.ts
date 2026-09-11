import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { isPostgresUrl } from "./src/lib/db/dialect";

// Mirrors the runtime dispatch in src/lib/db/index.ts and schema.ts: which
// dialect drizzle-kit targets (for `db:push`/`db:generate`/`db:studio`)
// follows DATABASE_URL the same way the app itself does, so there's one
// switch to get right, not three. See DATABASE.md at the repo root.
const databaseUrl = process.env.DATABASE_URL ?? "file:./local-dev.sqlite";
const postgres = isPostgresUrl(databaseUrl);

export default defineConfig(
  postgres
    ? {
        schema: "./src/lib/db/schema.postgres.ts",
        out: "./drizzle/postgres",
        dialect: "postgresql",
        dbCredentials: { url: databaseUrl },
        verbose: true,
        strict: true,
      }
    : {
        schema: "./src/lib/db/schema.sqlite.ts",
        out: "./drizzle/sqlite",
        dialect: "sqlite",
        dbCredentials: { url: databaseUrl },
        verbose: true,
        strict: true,
      }
);
