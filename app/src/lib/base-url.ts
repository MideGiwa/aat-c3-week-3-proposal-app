// Shared by anything that builds an absolute link into the app for an
// outbound email or Discord message (document download links, invite/setup
// links, the proposal link in a Discord notification) — one place so every
// link uses the same env var and the same fallback chain.
//
// APP_BASE_URL is the explicit override (a custom domain, or just to pin
// one deployment's URL) and always wins when set. Below that, Vercel's own
// system env vars are used before ever falling back to localhost — without
// this, any deploy where APP_BASE_URL hadn't been set manually would send
// every invite, resend-invite, Discord, *and client-facing proposal
// download* link as http://localhost:3000/..., which is only ever reachable
// on whoever's machine happens to be running `next dev` at that moment.
// VERCEL_PROJECT_PRODUCTION_URL is this project's stable production domain
// (e.g. a custom domain or the *-*.vercel.app one) and is preferred when
// present; VERCEL_URL is this specific deployment's own URL (set on every
// Vercel deployment, preview or production alike), which is still far
// better than localhost even when the production-domain var isn't
// available. Both are plain hostnames with no protocol, per Vercel's docs.
export function baseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
