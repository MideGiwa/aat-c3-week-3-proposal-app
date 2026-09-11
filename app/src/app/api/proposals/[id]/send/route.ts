import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, sections, events } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { generateProposalDocument } from "@/lib/document-service";
import { sendProposalEmail, EmailError } from "@/lib/email";

export const dynamic = "force-dynamic";

function baseUrl(): string {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

// POST /api/proposals/:id/send — the final step (architecture.md 3.7).
// Only callable once approved (or retrying a previous send_failed); always
// regenerates the document from current section content first rather than
// trusting an earlier preview, since content can still change after
// approval up until the moment it's actually sent.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  if (proposal.status !== "approved" && proposal.status !== "send_failed") {
    return NextResponse.json(
      { error: `Cannot send a proposal in status "${proposal.status}"` },
      { status: 409 }
    );
  }

  // Belt-and-suspenders: `submit` already refuses to move a proposal into
  // review while any section still needs input, so in the normal flow this
  // can never trip. It exists because status alone doesn't guarantee
  // content hasn't regressed — every route that can change a section's
  // content is itself gated to draft/changes_requested/generation_failed,
  // but the actual point of no return for the client is this one, so it
  // gets its own direct check rather than trusting that every upstream gate
  // held.
  const proposalSections = await db.select().from(sections).where(eq(sections.proposalId, id));
  const stillNeedsInput = proposalSections.filter((s) => s.needsInput);
  if (stillNeedsInput.length > 0) {
    return NextResponse.json(
      {
        error: "Cannot send — some sections still need input",
        sections: stillNeedsInput.map((s) => s.sectionKey),
      },
      { status: 409 }
    );
  }

  let documentId: string;
  try {
    const doc = await generateProposalDocument(id);
    documentId = doc.id;
    await db.insert(events).values({
      proposalId: id,
      eventType: "document_generated",
      detail: `PDF generated for delivery by ${user.name}`,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.insert(events).values({ proposalId: id, eventType: "document_failed", detail: reason });
    await db
      .update(proposals)
      .set({ status: "document_failed", lastError: reason, updatedAt: new Date() })
      .where(eq(proposals.id, id));
    return NextResponse.json(
      { error: "Could not generate the document to send", detail: reason },
      { status: 502 }
    );
  }

  const proposalLink = `${baseUrl()}/api/documents/${documentId}/download`;

  try {
    const result = await sendProposalEmail({
      clientEmail: proposal.clientEmail,
      clientName: proposal.clientName,
      companyName: proposal.companyName,
      salespersonName: user.name,
      proposalLink,
    });

    await db
      .update(proposals)
      .set({ status: "sent", lastError: null, updatedAt: new Date() })
      .where(eq(proposals.id, id));
    await db.insert(events).values({
      proposalId: id,
      eventType: "sent",
      detail: `Sent to ${proposal.clientEmail} via ${result.provider} by ${user.name} (document ${documentId})`,
    });

    return NextResponse.json({ ok: true, provider: result.provider });
  } catch (err) {
    const reason = err instanceof EmailError ? `${err.provider}: ${err.message}` : String(err);
    await db
      .update(proposals)
      .set({ status: "send_failed", lastError: reason, updatedAt: new Date() })
      .where(eq(proposals.id, id));
    await db.insert(events).values({ proposalId: id, eventType: "send_failed", detail: reason });

    return NextResponse.json({ error: "Send failed", detail: reason }, { status: 502 });
  }
}
