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
};

export type SendProposalEmailResult = {
  provider: EmailProvider;
  externalId: string;
};

function currentProvider(): EmailProvider {
  const raw = (process.env.EMAIL_PROVIDER || "resend").trim().toLowerCase();
  return raw === "n8n" ? "n8n" : "resend";
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
  const provider = currentProvider();
  const content = buildEmailContent(params);

  const externalId =
    provider === "n8n"
      ? await sendViaN8n(params, content)
      : await sendViaResend(params, content);

  return { provider, externalId };
}

async function sendViaResend(
  params: SendProposalEmailParams,
  content: { subject: string; text: string; html: string }
): Promise<string> {
  if (!process.env.RESEND_API_KEY) {
    throw new EmailError("resend", "RESEND_API_KEY is not set");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "proposals@example.com",
    to: params.clientEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });
  if (error) {
    throw new EmailError("resend", error.message || "Resend API error");
  }
  return data?.id ?? "unknown";
}

async function sendViaN8n(
  params: SendProposalEmailParams,
  content: { subject: string; text: string; html: string }
): Promise<string> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) {
    throw new EmailError("n8n", "N8N_WEBHOOK_URL is not set");
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
        to: params.clientEmail,
        clientName: params.clientName,
        companyName: params.companyName,
        salespersonName: params.salespersonName,
        proposalLink: params.proposalLink,
        subject: content.subject,
        html: content.html,
        text: content.text,
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
