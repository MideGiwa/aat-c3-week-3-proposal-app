import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, sections, events } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { notifyDiscord } from "@/lib/discord";
import { trackOwnershipPickup } from "@/lib/ownership";

export const dynamic = "force-dynamic";

// POST /api/proposals/:id/submit — draft -> pending_review. Blocked if any
// section is still flagged needs_input, so an incomplete proposal can't be
// pushed to a reviewer as if it were finished (connects PRD scenario 2's
// missing-info flags directly to the approval gate).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  if (proposal.status !== "draft" && proposal.status !== "changes_requested") {
    return NextResponse.json(
      { error: `Cannot submit a proposal in status "${proposal.status}"` },
      { status: 409 }
    );
  }

  const proposalSections = await db
    .select()
    .from(sections)
    .where(eq(sections.proposalId, id));

  const incomplete = proposalSections.filter(
    (s) => !s.currentContent.trim() || s.needsInput
  );
  if (incomplete.length > 0) {
    return NextResponse.json(
      {
        error: "Proposal still needs input before it can be submitted for review",
        sections: incomplete.map((s) => s.sectionKey),
      },
      { status: 409 }
    );
  }

  await db
    .update(proposals)
    .set({ status: "pending_review", updatedAt: new Date() })
    .where(eq(proposals.id, id));

  await db.insert(events).values({
    proposalId: id,
    eventType: "submitted_for_review",
    detail: `Submitted by ${user.name}`,
  });

  await trackOwnershipPickup({
    proposal,
    actingUser: user,
    actionLabel: "submitted for review",
  });

  await notifyDiscord({
    kind: "submitted_for_review",
    proposalId: id,
    clientName: proposal.clientName,
    companyName: proposal.companyName,
    actorName: user.name,
  });

  return NextResponse.json({ ok: true });
}
