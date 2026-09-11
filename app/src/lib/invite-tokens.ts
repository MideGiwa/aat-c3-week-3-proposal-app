import { randomBytes, createHash, timingSafeEqual } from "crypto";

// Invite links carry a random token, not a signed/derivable one — the
// setup route looks the user up by id and compares a hash of the token
// they present against the hash stored on that row. Only the hash is
// stored (see schema.ts on `users.inviteTokenHash`), so a database leak
// alone can't be replayed as a working invite link.

export const INVITE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours

export function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

// Constant-time comparison so a timing side-channel can't be used to guess
// a valid hash one byte at a time. Both inputs are fixed-length hex sha256
// digests, but only when they're actually equal-length hex strings —
// `timingSafeEqual` throws on a length mismatch, so that's checked first
// (this also cheaply catches accidental empty/malformed tokens).
export function inviteTokenMatches(rawToken: string, storedHash: string): boolean {
  const candidate = hashInviteToken(rawToken);
  if (candidate.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(storedHash, "hex"));
}

// A plain helper (not a component) so pages that just need to *display*
// whether a pending invite has expired don't each write their own
// `Date.now()` comparison inline.
export function isInviteTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() < Date.now();
}
