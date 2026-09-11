import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";

// Identity: email + an authenticator app (TOTP), no password — see
// src/lib/totp.ts. A signed-in session is just this cookie holding the
// user's id; there's no server-side session table to check against, so
// "signed in" only ever means "holds a cookie naming a user row that
// exists and is active." New users are provisioned by an approver via
// /team (src/app/api/users/invite) rather than self-registering, which is
// what actually enforces the salesperson/approver split the approval gate
// depends on — anyone who can sign in already has a role assigned by
// someone who could vouch for them.
//
// A local-dev-only shortcut (pick a seeded user, no code) still exists
// behind a literal `NODE_ENV === "development"` check in the login route,
// purely so local testing doesn't require an authenticator app per seeded
// user — it never runs in production.

const COOKIE_NAME = "uid";

// Sessions are short-lived by design (2 hours) rather than the effectively
// unlimited 30-day cookie this app started with — now that signing in
// means something (a real credential, not just picking a name), staying
// signed in indefinitely on a shared or unattended machine is a real
// exposure, not just a convenience trade-off. Re-authenticating means
// entering a fresh authenticator code, which costs nothing since the app
// never asked for a password to begin with.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 2;

export type CurrentUser = typeof users.$inferSelect;

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const id = store.get(COOKIE_NAME)?.value;
  if (!id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  // A user who is only "invited" has never completed authenticator setup
  // and has no business holding a valid session cookie — if one exists
  // anyway (a stale cookie from before an admin reset someone back to
  // invited, say), treat it as signed out rather than trusting it.
  if (!user || user.status !== "active") return null;
  return user;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
