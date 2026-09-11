// Single source of truth for "which backend does this DATABASE_URL mean?" —
// shared by src/lib/db/schema.ts (which table/relation definitions to
// export), src/lib/db/index.ts (which driver/client to open), and
// drizzle.config.ts (which dialect to hand drizzle-kit for push/generate).
// A Postgres connection string starts with postgres:// or postgresql://
// (Neon, and Postgres generally); anything else is treated as a libsql URL
// (file:./local-dev.sqlite for local dev, or a real libsql:/http(s):// URL).
export function isPostgresUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}
