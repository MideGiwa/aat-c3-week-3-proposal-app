// Single source of truth for "which backend does this DATABASE_URL mean?" —
// shared by src/lib/db/schema.ts (which table/relation definitions to
// export), src/lib/db/index.ts (which driver/client to open), and
// drizzle.config.ts (which dialect to hand drizzle-kit for push/generate).
// A Postgres connection string starts with postgres:// or postgresql://
// (Neon, and Postgres generally); anything else is treated as a libsql URL
// (file:./local-dev.sqlite for local dev, or a real libsql:/http(s):// URL).

// Guards against the two most common ways a pasted connection string ends
// up not matching its own scheme: leading/trailing whitespace (a stray
// newline from copy/paste, common when a value is piped into a dashboard's
// env var field) and a wrapping quote pair left over from copying a
// shell-quoted example (e.g. `'postgresql://...'`) straight into an env var
// value, where the quote characters themselves become part of the string.
export function normalizeDatabaseUrl(raw: string | undefined | null): string {
  if (!raw) return "";
  let url = raw.trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  return url;
}

function schemeOf(url: string): string {
  const i = url.indexOf(":");
  return i === -1 ? "" : url.slice(0, i + 1).toLowerCase();
}

export function isPostgresUrl(url: string | undefined | null): boolean {
  const scheme = schemeOf(normalizeDatabaseUrl(url));
  return scheme === "postgres:" || scheme === "postgresql:";
}

// file:/libsql:/http(s): are the schemes @libsql/client actually accepts.
// Anything else reaching the SQLite branch is almost certainly a
// misconfigured DATABASE_URL (wrong env var scope, stray quoting, a typo'd
// scheme) rather than a real intent to use SQLite, so it's worth failing
// loudly and specifically instead of letting libsql's own generic
// URL_INVALID be the only signal.
export function isRecognizedSqliteUrl(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === "file:" || scheme === "libsql:" || scheme === "http:" || scheme === "https:";
}
