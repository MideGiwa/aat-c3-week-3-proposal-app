import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// A single pooled connection, reused across hot reloads in dev so we don't
// exhaust connections. `DATABASE_URL` is required — see .env.example.
declare global {
  var __pgPool: Pool | undefined;
}

function createPool() {
  // Deliberately does not throw here: this module is imported by every
  // route (via auth -> db), including ones collected at build time before
  // any request exists, so failing fast has to happen at query time
  // instead — the pool only actually connects on first use.
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[db] DATABASE_URL is not set. Copy .env.example to .env.local and point it at your Postgres database — queries will fail until then."
    );
  }
  return new Pool({ connectionString: process.env.DATABASE_URL || undefined });
}

const pool = globalThis.__pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__pgPool = pool;

export const db = drizzle(pool, { schema });
export * as schema from "./schema";
