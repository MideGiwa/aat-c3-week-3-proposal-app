// --- TEMPORARY SQLITE SWAP -------------------------------------------------
// This file normally connects to Postgres via `pg` + drizzle-orm/node-postgres.
// It has been temporarily replaced with a local SQLite (libsql) connection so
// the app can run while Neon is unreachable over this network. The original
// version is preserved untouched at `index.postgres.bak.ts` in this same
// folder. See `TEMP-SQLITE-SETUP.md` at the repo root for setup + revert steps.
//
// `DATABASE_URL` should be a libsql file URL for this to work, e.g.:
//   DATABASE_URL=file:./local-dev.sqlite
// -----------------------------------------------------------------------------

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

// A single client, reused across hot reloads in dev so we don't reopen the
// file on every request. `DATABASE_URL` is required — see .env.example.
declare global {
  var __libsqlClient: ReturnType<typeof createClient> | undefined;
}

function createDbClient() {
  // Deliberately does not throw here: this module is imported by every
  // route (via auth -> db), including ones collected at build time before
  // any request exists, so failing fast has to happen at query time
  // instead — the client only actually opens the file on first use.
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[db] DATABASE_URL is not set. Copy .env.example to .env.local and point it at your database — queries will fail until then."
    );
  }
  return createClient({ url: process.env.DATABASE_URL || "file:./local-dev.sqlite" });
}

const client = globalThis.__libsqlClient ?? createDbClient();
if (process.env.NODE_ENV !== "production") globalThis.__libsqlClient = client;

export const db = drizzle(client, { schema });
export * as schema from "./schema";
