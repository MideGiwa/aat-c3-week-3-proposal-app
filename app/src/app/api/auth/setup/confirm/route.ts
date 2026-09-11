import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { findValidInvite, inviteLookupErrorMessage } from "@/lib/invite-lookup";
import { verifyTotpCode } from "@/lib/totp";
import { AUTH_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/setup/confirm — proves the person actually enrolled the
// secret from /setup/start in a real authenticator app (rather than, say,
// the link just having been opened) by requiring one valid code from it
// before the account is allowed to go live. On success this both activates
// the account and signs the person in immediately — they already proved
// they can produce a valid code, so making them then turn around and log
// in with that same authenticator would be a redundant extra step, not
// extra security.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const uid = typeof body?.uid === "string" ? body.uid : "";
  const token = typeof body?.token === "string" ? body.token : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!uid || !token) return NextResponse.json({ error: "Invalid invite link" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app" }, { status: 400 });

  const lookup = await findValidInvite(uid, token);
  if (!lookup.ok) {
    return NextResponse.json({ error: inviteLookupErrorMessage(lookup.reason) }, { status: 410 });
  }
  if (!lookup.user.totpSecret) {
    return NextResponse.json({ error: "Set up your authenticator app first" }, { status: 409 });
  }
  if (!verifyTotpCode(lookup.user.totpSecret, code)) {
    return NextResponse.json({ error: "That code didn't match — check your authenticator app and try again" }, { status: 401 });
  }

  try {
    await db
      .update(users)
      .set({ status: "active", inviteTokenHash: null, inviteTokenExpiresAt: null })
      .where(eq(users.id, uid));

    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE_NAME, uid, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("Failed to activate account after authenticator setup:", err);
    return NextResponse.json(
      { error: err instanceof Error ? `Could not activate your account: ${err.message}` : "Could not activate your account" },
      { status: 500 }
    );
  }
}
