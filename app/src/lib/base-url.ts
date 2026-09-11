// Shared by anything that builds an absolute link into the app for an
// outbound email (document download links, invite/setup links) — one place
// so every link uses the same env var and the same local fallback.
export function baseUrl(): string {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}
