import { baseUrl } from "@/lib/base-url";

// Best-effort Discord notifications for the moments the team wants
// visibility into without opening the app: a failure that needs someone's
// attention, a proposal waiting on an approver, what an approver decided,
// and a proposal actually going out the door. This deliberately mirrors
// the same events the dashboard already tracks (architecture.md 3.4's
// `events` table, and the "Needs attention" grouping on /proposals) rather
// than inventing a parallel notion of what's notable.
//
// Configured with a single DISCORD_WEBHOOK_URL (see .env.example). A native
// Discord "Incoming Webhook" needs no OAuth or bot setup — just a URL — so
// this posts to it directly rather than going through n8n the way email
// delivery can (n8n earns its keep there by fronting a real OAuth
// credential; there's no equivalent step here for it to add value over).
//
// Fire-and-forget in spirit, but actually awaited with a short timeout: a
// Discord outage, a bad webhook URL, or Discord itself being slow must
// never fail — or meaningfully delay — the underlying action (generation,
// approval, send) this is only reporting on. Every failure is swallowed
// here (after logging server-side) rather than surfaced to the caller.
export type DiscordNotificationKind =
  | "generation_failed"
  | "document_failed"
  | "send_failed"
  | "submitted_for_review"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "approval_undone"
  | "sent";

const TITLE_BY_KIND: Record<DiscordNotificationKind, string> = {
  generation_failed: "⚠️ AI generation failed",
  document_failed: "⚠️ Document generation failed",
  send_failed: "⚠️ Send to client failed",
  submitted_for_review: "📝 Submitted for approval",
  approved: "✅ Proposal approved",
  rejected: "❌ Proposal rejected",
  changes_requested: "🔁 Changes requested",
  // Grouped with the other approval-decision notifications (that's the
  // category the user picked when asked which events should notify) even
  // though it's not itself a new decision — an approver reversing an
  // earlier approval is exactly the kind of "needs someone's attention
  // again" moment that category exists for, and it was a real gap: this
  // silently flipped a proposal back to pending_review with no notification
  // at all before this was added.
  approval_undone: "↩️ Approval undone",
  sent: "📤 Sent to client",
};

// Discord embed side-bar colors, decimal RGB — red for the three failure
// states (matches the dashboard's red "Needs attention" badge), amber for
// "needs a decision", green for positive outcomes, orange for the one
// state that's neither a failure nor a resolution.
const COLOR_BY_KIND: Record<DiscordNotificationKind, number> = {
  generation_failed: 0xdc2626,
  document_failed: 0xdc2626,
  send_failed: 0xdc2626,
  submitted_for_review: 0xd97706,
  approved: 0x15803d,
  rejected: 0xdc2626,
  changes_requested: 0xea580c,
  approval_undone: 0xd97706,
  sent: 0x15803d,
};

const MAX_DETAIL_LENGTH = 500;

export async function notifyDiscord(params: {
  kind: DiscordNotificationKind;
  proposalId: string;
  clientName: string;
  companyName: string;
  actorName?: string;
  detail?: string | null;
}): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  // The feature is opt-in: no env var configured means no attempt, no log
  // noise, and no behavior change for anyone who hasn't set this up.
  if (!webhookUrl) return;

  const detail = params.detail
    ? params.detail.length > MAX_DETAIL_LENGTH
      ? `${params.detail.slice(0, MAX_DETAIL_LENGTH)}…`
      : params.detail
    : null;

  const descriptionLines = [`**${params.clientName}** — ${params.companyName}`];
  if (params.actorName) descriptionLines.push(`by ${params.actorName}`);
  if (detail) descriptionLines.push(detail);

  const embed = {
    title: TITLE_BY_KIND[params.kind],
    description: descriptionLines.join("\n"),
    url: `${baseUrl()}/proposals/${params.proposalId}`,
    color: COLOR_BY_KIND[params.kind],
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`Discord notification failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    console.error("Discord notification failed:", err);
  }
}
