import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { findValidInvite, inviteLookupErrorMessage } from "@/lib/invite-lookup";
import { generateTotpSecret, buildOtpauthUrl } from "@/lib/totp";

export const dynamic = "force-dynamic";

// POST /api/auth/setup/start — the first step on /setup-authenticator: given
// a still-valid uid+token, hands back a QR code to scan. Idempotent by
// design (reuses an existing secret rather than minting a new one every
// call) specifically so this being a side-effecting POST triggered
// automatically when the page loads is safe even if it fires more than
// once — an email link-preview bot hitting this before the real person
// does doesn't burn or rotate anything they'd notice.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const uid = typeof body?.uid === "string" ? body.uid : "";
  const token = typeof body?.token === "string" ? body.token : "";
  if (!uid || !token) return NextResponse.json({ error: "Invalid invite link" }, { status: 400 });

  const lookup = await findValidInvite(uid, token);
  if (!lookup.ok) {
    return NextResponse.json({ error: inviteLookupErrorMessage(lookup.reason) }, { status: 410 });
  }

  // Everything past this point (secret generation, the DB write, and QR
  // rendering) previously wasn't wrapped in a try/catch, so any failure
  // here — a locked/out-of-date local sqlite file, a qrcode/otpauth
  // version mismatch, whatever — surfaced to the browser as a raw 500 HTML
  // error page instead of JSON. The client's fetch then failed to parse
  // that as JSON and fell back to a generic "Could not start setup" with
  // no indication of what actually went wrong, while the real error only
  // ever showed up in the server's own terminal output. Catching it here
  // means the same failure now comes back as a real error message.
  try {
    const secretBase32 = lookup.user.totpSecret ?? generateTotpSecret();
    if (!lookup.user.totpSecret) {
      await db.update(users).set({ totpSecret: secretBase32 }).where(eq(users.id, uid));
    }

    const otpauthUrl = buildOtpauthUrl(secretBase32, lookup.user.email);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });

    return NextResponse.json({ secretBase32, otpauthUrl, qrDataUrl });
  } catch (err) {
    console.error("Failed to start authenticator setup:", err);
    return NextResponse.json(
      { error: err instanceof Error ? `Could not start setup: ${err.message}` : "Could not start setup" },
      { status: 500 }
    );
  }
}
