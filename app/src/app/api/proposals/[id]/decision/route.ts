import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, approvals, events } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/proposals/:id/decision — the internal approval gate
// (architecture.md 3.5). Only an `approver` can call this, and it's the
// only path from pending_review to approved — nothing reaches "sendable"
// without going through here (PRD scenario 5).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "approver") {
    return NextResponse.json({ error: "Only an approver can decide on a proposal" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const decision = body?.decision as "approved" | "rejected" | "changes_requested" | undefined;
  if (!decision || !["approved", "rejected", "changes_requested"].includes(decision)) {
    return NextResponse.json({ error: "decision must be approved, rejected, or changes_requested" }, { status: 400 });
  }

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  if (proposal.status !== "pending_review") {
    return NextResponse.json(
      { error: `Cannot decide on a proposal in status "${proposal.status}"` },
      { status: 409 }
    );
  }

  await db.insert(approvals).values({
    proposalId: id,
    reviewerId: user.id,
    decision,
    comment: body?.comment || null,
  });

  const nextStatus = decision === "approved" ? "approved" : decision === "rejected" ? "draft" : "changes_requested";

  await db
    .update(proposals)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(proposals.id, id));

  await db.insert(events).values({
    proposalId: id,
    eventType: decision,
    detail: body?.comment ? `${user.name}: ${body.comment}` : `Decided by ${user.name}`,
  });

  return NextResponse.json({ ok: true });
}
