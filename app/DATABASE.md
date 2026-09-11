# Database: SQLite in dev, Postgres in production

This app runs against either backend without any manual file-swapping,
because `DATABASE_URL`'s scheme decides which one is live at runtime:

| `DATABASE_URL` looks like... | Backend used | Typical case |
| --- | --- | --- |
| `file:./local-dev.sqlite` (or unset) | SQLite via `@libsql/client` | local dev |
| `libsql://...` | libsql/Turso | a hosted libsql database, if ever used |
| `postgres://...` or `postgresql://...` | Postgres via `pg` | production (Neon) |

## How the dispatch works

Three files share one check (`isPostgresUrl()` in `src/lib/db/dialect.ts`):

- `src/lib/db/index.ts` opens a `pg.Pool` or a `@libsql/client` client to
  match, and builds `db` with the matching drizzle driver.
- `src/lib/db/schema.ts` re-exports either `schema.postgres.ts` or
  `schema.sqlite.ts` — the actual table/relation definitions. Every other
  file in the app imports tables from `"@/lib/db/schema"`, never from the
  dialect-specific files directly, so it never needs to know which backend
  is live.
- `drizzle.config.ts` points `drizzle-kit` (used for `db:push` /
  `db:generate` / `db:studio`) at whichever dialect-specific schema file and
  Postgres/SQLite `dialect` matches the same `DATABASE_URL`.

`schema.postgres.ts` and `schema.sqlite.ts` define the exact same tables,
columns, and relations — same names, same TypeScript-visible data types —
just with each dialect's native column types (`uuid`/`timestamp`/`boolean`
vs. `text`/`integer`). **They're kept in sync by hand**: a schema change
needs to be made in both files. `db`'s exported TypeScript type is asserted
to the SQLite variant so the app type-checks the same regardless of which
backend is actually live; that's a compile-time convenience only; at
runtime `db` is genuinely whichever backend `DATABASE_URL` points at.

## Migrations run automatically on every build

`pnpm run build` runs `drizzle-kit push --force` before `next build`, so
the live database's schema is brought up to date as part of every deploy —
including Vercel's build step, which is what actually creates the tables on
a fresh Neon database the first time it deploys. `push` diffs the schema
against the real database and applies only what changed, so re-running it
on every build is safe and normally a no-op once the schema hasn't moved.

`--force` skips the interactive confirmation prompt `drizzle-kit push`
would otherwise show for a destructive change (e.g. dropping a column),
which is required for a non-interactive build pipeline. This is the right
tradeoff for this project's stage (schema iteration via `push`, no
generated migration files), but it does mean a destructive schema change
would apply without a prompt on the next deploy — worth knowing if this
app ever holds data you can't afford to lose.

## Local setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` — either
   `file:./local-dev.sqlite` (SQLite, no setup needed) or a real Postgres
   connection string (Neon or otherwise).
2. `pnpm install`
3. `pnpm run db:push:force && pnpm run seed`
4. `pnpm run dev`

Switching a local checkout from one backend to the other is just changing
`DATABASE_URL` and re-running step 3 — no files to swap.
