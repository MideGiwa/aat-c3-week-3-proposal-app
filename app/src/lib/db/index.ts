// Opens the right database client for whatever DATABASE_URL actually is —
// a local SQLite/libsql file for dev, or a real Postgres connection (Neon
// in production) — instead of requiring the two to be swapped by hand in
// separate files. See `schema.ts` in this folder for the matching
// table/relation dispatch, `dialect.ts` for the shared URL check, and
// DATABASE.md at the repo root for the full picture and history (this
// replaces an earlier manual swap that briefly went to production still
// pointed at the SQLite driver against a Postgres URL and failed the
// Vercel build with `LibsqlError: URL_INVALID`).
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as sqliteSchema from "./schema.sqlite";
import * as postgresSchema from "./schema.postgres";
import { isPostgresUrl, isRecognizedSqliteUrl, normalizeDatabaseUrl } from "./dialect";

// Deliberately does not throw when unset: this module is imported by every
// route (via auth -> db), including ones collected at build time before any
// request exists, so failing fast has to happen at query time instead — the
// client only actually opens a connection on first use.
if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] DATABASE_URL is not set. Copy .env.example to .env.local and point it at your database — queries will fail until then."
  );
}
// normalizeDatabaseUrl trims whitespace and strips an accidental wrapping
// quote pair (see dialect.ts) — both real mistakes when pasting a
// connection string into a dashboard's env var field, and both would
// otherwise make a perfectly good postgres:// URL fail the scheme check
// below and silently fall through to the SQLite branch instead.
const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL) || "file:./local-dev.sqlite";

function createDbAndClient() {
  if (isPostgresUrl(databaseUrl)) {
    const pool = new Pool({ connectionString: databaseUrl });
    return { client: pool as unknown, db: drizzlePg(pool, { schema: postgresSchema }) };
  }
  if (!isRecognizedSqliteUrl(databaseUrl)) {
    // Reaching here with something that's neither a postgres:// URL nor a
    // recognized libsql scheme (file:/libsql:/http(s):) means DATABASE_URL
    // is set to *something*, just not anything this app knows how to open —
    // almost always a misconfigured env var (wrong Vercel environment
    // scope, a stray quote or newline that survived normalization, a typo'd
    // scheme) rather than a real attempt to use SQLite. Failing here with
    // the actual scheme (never the full URL, which may carry credentials)
    // is far more diagnosable than the opaque `LibsqlError: URL_INVALID`
    // this used to surface as instead.
    const shown = databaseUrl.slice(0, 12) || "(empty)";
    throw new Error(
      `[db] DATABASE_URL doesn't look like a Postgres or SQLite/libsql URL (starts with "${shown}..."). ` +
        `A Neon/Postgres connection string must start with postgres:// or postgresql://. ` +
        `A local SQLite path should look like file:./local-dev.sqlite. ` +
        `Check for a stray quote, extra whitespace, or the wrong Vercel environment scope.`
    );
  }
  const client = createClient({ url: databaseUrl });
  return { client: client as unknown, db: drizzleLibsql(client, { schema: sqliteSchema }) };
}

// A single client/pool, reused across hot reloads in dev so we don't
// reopen the file or exhaust connections on every request.
declare global {
  var __dbInstance: ReturnType<typeof createDbAndClient> | undefined;
}

const instance = globalThis.__dbInstance ?? createDbAndClient();
if (process.env.NODE_ENV !== "production") globalThis.__dbInstance = instance;

// Exported as the SQLite variant's type — the two schemas are kept
// field-for-field identical on purpose (see DATABASE.md), so every query
// built through `db` (via the table objects re-exported from
// "@/lib/db/schema", which resolve the same way) type-checks the same
// regardless of which dialect is actually live. At runtime `db` is
// genuinely whichever backend DATABASE_URL points at — this assertion only
// affects what TypeScript believes, not what code actually runs.
export const db = instance.db as ReturnType<typeof drizzleLibsql<typeof sqliteSchema>>;
export * as schema from "./schema";
