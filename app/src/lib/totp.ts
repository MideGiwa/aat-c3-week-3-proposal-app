import * as OTPAuth from "otpauth";

// Thin wrapper around `otpauth` so every call site uses the same issuer,
// digit count, and clock-drift tolerance rather than re-deriving them.
// Nothing here talks to a network — TOTP is entirely local math (HMAC over
// a shared secret and the current 30-second time step), which is exactly
// why it works with any standard authenticator app (Google Authenticator,
// Authy, 1Password, etc.) with no registration on our side.

const ISSUER = "Koya Talent Proposals";

function totpFor(secretBase32: string, accountEmail: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountEmail,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

// A fresh random secret for a user enrolling their authenticator for the
// first time. Base32-encoded, per the TOTP spec, so it's typeable by hand
// as a fallback when a device can't scan the QR code.
export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

// The otpauth:// URI an authenticator app scans (as a QR code) to enroll
// the account — encodes the issuer, account label, and secret in one go.
export function buildOtpauthUrl(secretBase32: string, accountEmail: string): string {
  return totpFor(secretBase32, accountEmail).toString();
}

// Verifies a submitted code against the stored secret. `window: 1` accepts
// the previous and next 30-second step too, so a slightly-off device clock
// or the delay of actually typing 6 digits doesn't cause spurious failures
// — standard practice for TOTP verification.
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const delta = totpFor(secretBase32, "verify").validate({ token: trimmed, window: 1 });
  return delta !== null;
}
