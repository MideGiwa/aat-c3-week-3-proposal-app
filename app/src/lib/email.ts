import { Resend } from "resend";

// Delivery service (architecture.md 3.7), with a config-only switch
// between two providers: Resend (default, an API call this app makes
// directly) and n8n (this app hands the send off to a webhook, and an n8n
// workflow does the actual sending — useful if the team already routes
// outbound email through n8n, or wants sending to go through a workflow
// they can inspect/modify without a code deploy). Nothing about the rest
// of the app depends on which one is active.

export type EmailProvider = "resend" | "n8n";

export class EmailError extends Error {
  constructor(
    public provider: EmailProvider,
    message: string
  ) {
    super(message);
    this.name = "EmailError";
  }
}

export type SendProposalEmailParams = {
  clientEmail: string;
  clientName: string;
  companyName: string;
  salespersonName: string;
  proposalLink: string;
  // The salesperson who owns the proposal and whoever approved it should
  // both stay in the loop on the actual send — they get copied on the
  // client-facing email rather than only seeing it land via the internal
  // event log. Caller is responsible for deduping/omitting the client's own
  // address; this is passed straight through to the provider as-is.
  ccEmails?: string[];
};

export type SendProposalEmailResult = {
  provider: EmailProvider;
  externalId: string;
};

// The generic send underneath both `sendProposalEmail` and
// `sendInviteEmail` (and any future transactional email) — one place that
// knows how to actually reach Resend or n8n, so a new email type never has
// to re-implement the provider switch or its error handling.
export type SendEmailParams = {
  to: string;
  ccEmails?: string[];
  subject: string;
  html: string;
  text: string;
  // Extra fields merged into the n8n webhook payload only (Resend ignores
  // this entirely). Lets a specific email type (proposal delivery, today)
  // hand useful context to a downstream n8n workflow without forcing every
  // email type to fabricate values for fields that don't apply to it.
  n8nExtra?: Record<string, unknown>;
  // Which env var holds the target webhook URL for this email type, so a
  // team can point proposal delivery and team invites at two separate n8n
  // workflows (e.g. to review/change one without touching the other).
  // Falls back to N8N_WEBHOOK_URL if the specific one isn't set, so a team
  // that only configured one webhook still gets a working send either way
  // — both workflows accept the same {to, cc, subject, html, text} shape.
  n8nWebhookUrlEnv?: "N8N_WEBHOOK_URL" | "N8N_INVITE_WEBHOOK_URL";
};

export type SendEmailResult = SendProposalEmailResult;

function currentProvider(): EmailProvider {
  const raw = (process.env.EMAIL_PROVIDER || "resend").trim().toLowerCase();
  return raw === "n8n" ? "n8n" : "resend";
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const provider = currentProvider();
  const externalId =
    provider === "n8n" ? await sendViaN8nGeneric(params) : await sendViaResendGeneric(params);
  return { provider, externalId };
}

// Mirrors client-email-template.md — kept as one function so both
// providers send an identical message regardless of transport.
function buildEmailContent(params: SendProposalEmailParams) {
  const subject = `Proposal for ${params.companyName}`;

  const text = [
    `Hi ${params.clientName},`,
    "",
    "Thanks again for taking the time to speak with us. Based on our conversation, we have put together a customized proposal for your review.",
    "",
    `You can view the proposal here: ${params.proposalLink}`,
    "",
    "This document outlines the project scope, timeline, pricing details, and recommended approach.",
    "",
    "If you have any questions or would like to make adjustments, feel free to reach out. We are happy to iterate with you.",
    "",
    "Looking forward to hearing your thoughts.",
    "",
    "Best regards,",
    "",
    params.salespersonName,
    "Koya Talent",
  ].join("\n");

  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  const html = `
    <p>Hi ${esc(params.clientName)},</p>
    <p>Thanks again for taking the time to speak with us. Based on our conversation, we have put together a customized proposal for your review.</p>
    <p>You can view the proposal here: <a href="${params.proposalLink}">${esc(params.proposalLink)}</a></p>
    <p>This document outlines the project scope, timeline, pricing details, and recommended approach.</p>
    <p>If you have any questions or would like to make adjustments, feel free to reach out. We are happy to iterate with you.</p>
    <p>Looking forward to hearing your thoughts.</p>
    <p>Best regards,<br/>${esc(params.salespersonName)}<br/>Koya Talent</p>
  `.trim();

  return { subject, text, html };
}

export async function sendProposalEmail(
  params: SendProposalEmailParams
): Promise<SendProposalEmailResult> {
  const content = buildEmailContent(params);
  return sendEmail({
    to: params.clientEmail,
    ccEmails: params.ccEmails,
    subject: content.subject,
    html: content.html,
    text: content.text,
    // Kept as extra (optional) fields for n8n specifically, in case a
    // workflow wants to key off them — unchanged from before this was
    // generalized, so an existing n8n setup doesn't need to change.
    n8nExtra: {
      clientName: params.clientName,
      companyName: params.companyName,
      salespersonName: params.salespersonName,
      proposalLink: params.proposalLink,
    },
  });
}

// Sent when an approver adds a new teammate (architecture.md's auth
// section, added alongside authenticator-app sign-in): the recipient has no
// account they can use yet, just a one-time link that lets them enroll an
// authenticator and activate it themselves.
export type SendInviteEmailParams = {
  toEmail: string;
  toName: string;
  role: "salesperson" | "approver";
  inviterName: string;
  setupLink: string;
  expiresInHours: number;
};

export async function sendInviteEmail(params: SendInviteEmailParams): Promise<SendEmailResult> {
  const subject = "You're invited to Koya Talent Proposals";
  const roleLabel = params.role === "approver" ? "an approver" : "a salesperson";

  const text = [
    `Hi ${params.toName},`,
    "",
    `${params.inviterName} has added you to Koya Talent Proposals as ${roleLabel}.`,
    "",
    `Set up your account here: ${params.setupLink}`,
    "",
    "You'll need an authenticator app (Google Authenticator, Authy, 1Password, etc.) — the link walks you through scanning a QR code to finish setup. There's no password; your authenticator app's code is how you sign in from now on.",
    "",
    `This link expires in ${params.expiresInHours} hours. If it expires before you use it, ask ${params.inviterName} to send you a new one.`,
    "",
    "— Koya Talent",
  ].join("\n");

  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  const html = `
    <p>Hi ${esc(params.toName)},</p>
    <p>${esc(params.inviterName)} has added you to Koya Talent Proposals as ${esc(roleLabel)}.</p>
    <p><a href="${params.setupLink}">Set up your account</a> to get started.</p>
    <p>You'll need an authenticator app (Google Authenticator, Authy, 1Password, etc.) — the link walks you through scanning a QR code to finish setup. There's no password; your authenticator app's code is how you sign in from now on.</p>
    <p>This link expires in ${params.expiresInHours} hours. If it expires before you use it, ask ${esc(params.inviterName)} to send you a new one.</p>
    <p>— Koya Talent</p>
  `.trim();

  return sendEmail({ to: params.toEmail, subject, html, text, n8nWebhookUrlEnv: "N8N_INVITE_WEBHOOK_URL" });
}

async function sendViaResendGeneric(params: SendEmailParams): Promise<string> {
  if (!process.env.RESEND_API_KEY) {
    throw new EmailError("resend", "RESEND_API_KEY is not set");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "proposals@example.com",
    to: params.to,
    ...(params.ccEmails && params.ccEmails.length > 0 ? { cc: params.ccEmails } : {}),
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
  if (error) {
    throw new EmailError("resend", error.message || "Resend API error");
  }
  return data?.id ?? "unknown";
}

async function sendViaN8nGeneric(params: SendEmailParams): Promise<string> {
  const preferredEnv = params.n8nWebhookUrlEnv ?? "N8N_WEBHOOK_URL";
  const url = process.env[preferredEnv] || process.env.N8N_WEBHOOK_URL;
  if (!url) {
    throw new EmailError("n8n", `${preferredEnv} (or N8N_WEBHOOK_URL) is not set`);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        to: params.to,
        cc: params.ccEmails ?? [],
        subject: params.subject,
        html: params.html,
        text: params.text,
        ...(params.n8nExtra ?? {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new EmailError(
      "n8n",
      `Could not reach the n8n webhook: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EmailError("n8n", `n8n webhook responded ${res.status}: ${body.slice(0, 300)}`);
  }

  // n8n workflows can be configured to "respond immediately" or "respond
  // with last node's output" — we don't require a specific response shape,
  // just a 2xx to treat the handoff as successful.
  const body = await res.text().catch(() => "");
  return body.slice(0, 200) || "accepted";
}
