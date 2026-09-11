import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";
import { inviteTokenMatches, isInviteTokenExpired } from "./invite-tokens";

export type InviteLookupFailureReason = "not_found" | "already_active" | "no_token" | "bad_token" | "expired";

export type InviteLookupResult =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; reason: InviteLookupFailureReason };

// Shared by /api/auth/setup/start and /api/auth/setup/confirm — both need
// the exact same "is this uid+token combination still a live invite"
// check, and a link that passes one but not the other would be a bug, not
// a feature, so there's exactly one place this logic lives.
export async function findValidInvite(uid: string, rawToken: string): Promise<InviteLookupResult> {
  const [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  if (!user) return { ok: false, reason: "not_found" };
  if (user.status === "active") return { ok: false, reason: "already_active" };
  if (!user.inviteTokenHash) return { ok: false, reason: "no_token" };
  if (!inviteTokenMatches(rawToken, user.inviteTokenHash)) return { ok: false, reason: "bad_token" };
  if (isInviteTokenExpired(user.inviteTokenExpiresAt)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, user };
}

export function inviteLookupErrorMessage(reason: InviteLookupFailureReason): string {
  switch (reason) {
    case "not_found":
      return "This invite link isn't valid.";
    case "already_active":
      return "This account has already completed setup — sign in instead.";
    case "expired":
      return "This invite link has expired. Ask an approver to resend it.";
    case "no_token":
    case "bad_token":
    default:
      return "This invite link isn't valid.";
  }
}
