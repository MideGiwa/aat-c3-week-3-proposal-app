# Temporary local SQLite swap

This is a stopgap, not a permanent feature: `DATABASE_URL` (Neon) was unreachable
over the current network, so the app's DB layer was temporarily swapped from
Postgres to a local SQLite file so development could continue. **Delete this
file and follow "Reverting" below once Neon is reachable again.**

## What changed

Three files were swapped in place, each with the original preserved right next
to it:

| Live file (now SQLite)                | Backup (original Postgres version)             |
| -------------------------------------- | ----------------------------------------------- |
| `src/lib/db/schema.ts`                 | `src/lib/db/schema.postgres.bak.ts`             |
| `src/lib/db/index.ts`                  | `src/lib/db/index.postgres.bak.ts`              |
| `drizzle.config.ts`                    | `drizzle.config.postgres.bak.ts`                |

Every table/column name and every exported symbol in the SQLite schema matches
the Postgres one exactly (UUIDs are still UUID strings, timestamps are still
real `Date` objects, booleans are still booleans, the status/role/etc. text
values are still typed unions) — so no other file in the app changed. All
routes, `auth.ts`, and `seed.ts` work unmodified against either backend.

Also added:
- `@libsql/client` to `package.json` (the driver `drizzle-orm/libsql` needs).
- A `*.sqlite` / `*.sqlite-*` entry in `.gitignore` so the local db file itself
  never gets committed.

## Setup (do this once)

1. **Install the new dependency** — this wasn't run automatically since it
   needs to run on your machine:
   ```
   pnpm install
   ```
2. **Point `DATABASE_URL` at a local file.** Edit `app/.env` yourself (the
   remote tools can't write `.env` for security reasons) — comment out the
   Neon line and add:
   ```
   DATABASE_URL=file:./local-dev.sqlite
   ```
3. **Create the schema and seed it:**
   ```
   pnpm run db:push:force
   pnpm run seed
   ```
4. **Restart the dev server** (stop it if running, then):
   ```
   pnpm run dev
   ```

You should be able to sign in and create/generate/approve/send proposals
exactly as before — the only thing that changed is where the data lives.
Email sending and PDF generation are unaffected (they don't touch the DB
layer at all), and Claude generation still needs `ANTHROPIC_API_KEY` as usual.

## Reverting once Neon is reachable again

1. Restore the three original files:
   ```
   cp src/lib/db/schema.postgres.bak.ts src/lib/db/schema.ts
   cp src/lib/db/index.postgres.bak.ts src/lib/db/index.ts
   cp drizzle.config.postgres.bak.ts drizzle.config.ts
   ```
2. Delete the three `.bak.ts` files and this `TEMP-SQLITE-SETUP.md` file.
3. Remove `@libsql/client` from `package.json` (optional — harmless to leave,
   but it's dead weight once you're back on Postgres) and run `pnpm install`
   again.
4. Edit `app/.env`: remove the `DATABASE_URL=file:./local-dev.sqlite` line and
   uncomment/restore the Neon line.
5. Delete the local db file(s): `local-dev.sqlite`, `local-dev.sqlite-shm`,
   `local-dev.sqlite-wal` if present.
6. Restart the dev server.

Nothing about this swap touched the Neon database itself — any proposals
created while on SQLite only exist in `local-dev.sqlite` and won't appear
once you're back on Postgres, and vice versa.
