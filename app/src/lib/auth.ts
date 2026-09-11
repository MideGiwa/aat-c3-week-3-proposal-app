import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";

// Deliberately minimal for this stage of the build: a small, fixed set of
// internal users, chosen at "login" with no password, identified by a
// cookie. See architecture.md section 4 — this is enough to enforce the
// salesperson/approver role split the approval gate depends on, without
// building a full identity system. Swap this for real auth (magic link,
// SSO) before this is anything but an internal course project.

const COOKIE_NAME = "uid";

export type CurrentUser = typeof users.$inferSelect;

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const id = store.get(COOKIE_NAME)?.value;
  if (!id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
