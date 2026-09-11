import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { generateInviteToken, hashInviteToken, INVITE_TOKEN_TTL_MS } from "@/lib/invite-tokens";
import { sendInviteEmail, EmailError } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

// POST /api/users/:id/resend-invite — issues a fresh token (invalidating
// whatever link was sent before, expired or not) and re-sends the email.
// Exists specifically for the 48-hour expiry window on invite links: rather
// than that being a dead end, an approver can always get the pending
// teammate a working link without deleting and re-creating the whole row
// (which would also lose the "invited by / on" record).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (currentUser.role !== "approver") {
    return NextResponse.json({ error: "Only an approver can resend an invite" }, { status: 403 });
  }

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.status !== "invited") {
    return NextResponse.json(
      { error: "This user has already completed setup — nothing to resend" },
      { status: 409 }
    );
  }

  const rawToken = generateInviteToken();
  await db
    .update(users)
    .set({
      inviteTokenHash: hashInviteToken(rawToken),
      inviteTokenExpiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    })
    .where(eq(users.id, id));

  const setupLink = `${baseUrl()}/setup-authenticator?uid=${target.id}&token=${rawToken}`;
  const devSetupLink = process.env.NODE_ENV === "development" ? setupLink : undefined;

  try {
    await sendInviteEmail({
      toEmail: target.email,
      toName: target.name,
      role: target.role,
      inviterName: currentUser.name,
      setupLink,
      expiresInHours: Math.round(INVITE_TOKEN_TTL_MS / (60 * 60 * 1000)),
    });
    return NextResponse.json({ ok: true, devSetupLink });
  } catch (err) {
    // The new token is already saved above — the resend itself succeeded,
    // only delivery failed — so this comes back as a 200 with a warning
    // field, the same shape /api/users/invite uses for the same situation,
    // rather than a 4xx/5xx that would make the client throw before ever
    // reading `devSetupLink`.
    const reason = err instanceof EmailError ? `${err.provider}: ${err.message}` : String(err);
    return NextResponse.json({ ok: true, emailError: reason, devSetupLink });
  }
}
