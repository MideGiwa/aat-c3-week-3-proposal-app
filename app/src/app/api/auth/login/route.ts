import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { AUTH_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { verifyTotpCode } from "@/lib/totp";

export const dynamic = "force-dynamic";

function setSessionCookie(res: NextResponse, userId: string) {
  res.cookies.set(AUTH_COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

// POST /api/auth/login — real sign-in is email + a 6-digit code from an
// authenticator app (src/lib/totp.ts), checked against the secret set up
// once at /setup-authenticator. A separate `userId`-only path exists purely
// for local development (see src/lib/auth.ts) and is refused outright
// outside `next dev` — gated on a literal `process.env.NODE_ENV ===
// "development"` check, the same pattern already used in storage.ts, so
// there's no risk of it slipping into a production build's behavior.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (body?.userId) {
    if (process.env.NODE_ENV !== "development") {
      return NextResponse.json({ error: "Not available" }, { status: 403 });
    }
    const [user] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
    if (!user) return NextResponse.json({ error: "Unknown user" }, { status: 404 });
    // Same status gate the real login path enforces (and getCurrentUser
    // re-checks on every request regardless) — this dev-only shortcut
    // exists to skip typing an authenticator code, not to skip whether the
    // account can sign in at all. Without this, a removed or not-yet-set-up
    // account could still get a session cookie through here.
    if (user.status !== "active") {
      return NextResponse.json({ error: `This account is ${user.status}, not active` }, { status: 403 });
    }
    const res = NextResponse.json({ user });
    setSessionCookie(res, user.id);
    return res;
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!email || !code) {
    return NextResponse.json({ error: "Email and code are required" }, { status: 400 });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Same generic error whether the email doesn't exist, the account hasn't
  // finished authenticator setup, or the code is wrong — distinguishing
  // those for the caller would let someone probe which emails have
  // accounts here.
  const invalid = () => NextResponse.json({ error: "Invalid email or code" }, { status: 401 });

  if (!user || user.status !== "active" || !user.totpSecret) return invalid();
  if (!verifyTotpCode(user.totpSecret, code)) return invalid();

  const res = NextResponse.json({ user });
  setSessionCookie(res, user.id);
  return res;
}

// GET /api/auth/login — the login page uses this to decide whether to show
// the local-dev quick-switch list at all. Outside development it always
// comes back empty, so there's nothing for a production build to expose.
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ devLoginEnabled: false, users: [] });
  }
  const rows = await db.select().from(users).where(eq(users.status, "active"));
  return NextResponse.json({ devLoginEnabled: true, users: rows });
}
