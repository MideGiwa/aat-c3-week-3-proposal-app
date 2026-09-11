import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, sections, sectionVersions, events } from "@/lib/db/schema";
import { contentNeedsInput, isEditableStatus } from "@/lib/proposal-fields";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// PATCH /api/proposals/:id/sections/:sectionId — a manual edit by the
// salesperson. Writes a new section_versions row rather than overwriting,
// so history is never destroyed by an edit (PRD scenario 4).
//
// Gated to the same statuses the editor UI's `canEdit` uses, enforced here
// rather than trusted to the UI: without this, a direct call could edit a
// section after approval (even reintroducing a "[NEEDS INPUT: ...]"
// placeholder) and the next "Send to client" would happily bake that into
// the PDF, since generateProposalDocument's own check is only "is there any
// content at all", not "is it actually finished".
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { id, sectionId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.content !== "string") {
    return NextResponse.json({ error: "Missing content" }, { status: 400 });
  }

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  if (!isEditableStatus(proposal.status)) {
    return NextResponse.json(
      { error: `Cannot edit a section while status is "${proposal.status}"` },
      { status: 409 }
    );
  }

  const section = await db.query.sections.findFirst({
    where: eq(sections.id, sectionId),
  });
  if (!section || section.proposalId !== id) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const needsInput = contentNeedsInput(body.content);

  const [version] = await db
    .insert(sectionVersions)
    .values({ sectionId, content: body.content, generatedBy: "human", needsInput })
    .returning();
  await db
    .update(sections)
    .set({
      currentContent: body.content,
      needsInput,
      currentVersionId: version.id,
      updatedAt: new Date(),
    })
    .where(eq(sections.id, sectionId));

  await db.insert(events).values({
    proposalId: id,
    eventType: "section_edited",
    detail: `${section.sectionKey} edited by ${user.name}`,
  });

  return NextResponse.json({ ok: true });
}
