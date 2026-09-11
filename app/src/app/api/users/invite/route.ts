import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { generateInviteToken, hashInviteToken, INVITE_TOKEN_TTL_MS } from "@/lib/invite-tokens";
import { sendInviteEmail, EmailError } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/users/invite — the only way a new account gets created. There
// is no public sign-up: an approver vouches for a teammate by name, email,
// and role, and the invite link is the one thing that lets the recipient
// turn that row into an account they can actually sign in with (by
// enrolling an authenticator at /setup-authenticator). Restricting this to
// approvers, not "any signed-in user," mirrors the same reasoning as the
// approval gate itself — provisioning who can act as an approver shouldn't
// be something a salesperson can do to themselves.
export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (currentUser.role !== "approver") {
    return NextResponse.json({ error: "Only an approver can invite a new teammate" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body?.role as "salesperson" | "approver" | undefined;

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (role !== "salesperson" && role !== "approver") {
    return NextResponse.json({ error: "Role must be salesperson or approver" }, { status: 400 });
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    const reason =
      existing.status === "active"
        ? "A user with this email already exists"
        : "An invite for this email is already pending — use Resend invite instead of creating a new one";
    return NextResponse.json({ error: reason }, { status: 409 });
  }

  const rawToken = generateInviteToken();
  const [created] = await db
    .insert(users)
    .values({
      name,
      email,
      role,
      status: "invited",
      invitedBy: currentUser.id,
      inviteTokenHash: hashInviteToken(rawToken),
      inviteTokenExpiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    })
    .returning();

  const setupLink = `${baseUrl()}/setup-authenticator?uid=${created.id}&token=${rawToken}`;
  // Only ever present in local dev — the raw token is otherwise unrecoverable
  // by design (only its hash is stored), which is exactly the point; this
  // exists purely so `next dev` doesn't require a working email provider to
  // exercise the invite flow.
  const devSetupLink = process.env.NODE_ENV === "development" ? setupLink : undefined;

  try {
    await sendInviteEmail({
      toEmail: email,
      toName: name,
      role,
      inviterName: currentUser.name,
      setupLink,
      expiresInHours: Math.round(INVITE_TOKEN_TTL_MS / (60 * 60 * 1000)),
    });
    return NextResponse.json({ ok: true, user: created, devSetupLink });
  } catch (err) {
    // The account is still created (and can be fixed with "Resend invite")
    // — an email provider hiccup shouldn't force the approver to redo the
    // whole form, just retry delivery.
    const reason = err instanceof EmailError ? `${err.provider}: ${err.message}` : String(err);
    return NextResponse.json(
      { ok: true, user: created, emailError: reason, devSetupLink },
      { status: 200 }
    );
  }
}
