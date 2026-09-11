import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvals, proposals, events } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/proposals/:id/undo-approval — lets an approver walk back an
// "approved" decision they (or another approver) made, as long as no one
// has acted on it yet. Only reachable from "approved" specifically — once a
// send has actually been attempted (send_failed/document_failed), the
// document/event trail already reflects that attempt, so reversing the
// approval underneath it would be confusing rather than helpful; that case
// isn't "before email sending" the way a plain approved proposal is.
//
// This puts the proposal back at "pending_review" (undoing the one
// transition the decision route made) rather than "draft" or
// "changes_requested" — those are actual decisions with their own meaning,
// and undo isn't one, it's "that approval didn't happen."
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "approver") {
    return NextResponse.json({ error: "Only an approver can undo an approval" }, { status: 403 });
  }

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  if (proposal.status !== "approved") {
    return NextResponse.json(
      { error: `Cannot undo approval on a proposal in status "${proposal.status}"` },
      { status: 409 }
    );
  }

  const activeApproval = await db.query.approvals.findFirst({
    where: and(eq(approvals.proposalId, id), eq(approvals.decision, "approved"), isNull(approvals.undoneAt)),
    orderBy: [desc(approvals.decidedAt)],
  });
  if (!activeApproval) {
    return NextResponse.json(
      { error: "No active approval was found on this proposal to undo" },
      { status: 409 }
    );
  }

  await db
    .update(approvals)
    .set({ undoneAt: new Date(), undoneBy: user.id })
    .where(eq(approvals.id, activeApproval.id));

  await db
    .update(proposals)
    .set({ status: "pending_review", updatedAt: new Date() })
    .where(eq(proposals.id, id));

  await db.insert(events).values({
    proposalId: id,
    eventType: "approval_undone",
    detail: `Undone by ${user.name} — back to pending review`,
  });

  return NextResponse.json({ ok: true });
}
