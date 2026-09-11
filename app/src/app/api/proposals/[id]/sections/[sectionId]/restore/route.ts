import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, sections, sectionVersions, events } from "@/lib/db/schema";
import { isEditableStatus } from "@/lib/proposal-fields";
import { getCurrentUser } from "@/lib/auth";
import { trackOwnershipPickup } from "@/lib/ownership";

export const dynamic = "force-dynamic";

// POST /api/proposals/:id/sections/:sectionId/restore — point a section's
// "current" content back at an earlier version rather than overwriting
// anything: like PATCH (manual edit) and regenerate, this never deletes a
// version, it only moves currentVersionId/currentContent, so restoring is
// itself just another entry in the same history it's restoring from.
//
// Reuses the "section_edited" event type rather than adding a new
// "section_restored" enum value — this app's event types are a real
// Postgres enum, so adding one means every environment (including
// production/Neon) has to run a schema migration before this would work
// there. The detail text below makes a restore distinguishable from a
// plain edit in the activity timeline without that migration.
//
// Gated to the same statuses as PATCH/regenerate on this same resource:
// restoring an old version is just as capable of putting a
// "[NEEDS INPUT: ...]" placeholder back into "current" as either of those.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { id, sectionId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.versionId !== "string") {
    return NextResponse.json({ error: "Missing versionId" }, { status: 400 });
  }

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  if (!isEditableStatus(proposal.status)) {
    return NextResponse.json(
      { error: `Cannot restore a section while status is "${proposal.status}"` },
      { status: 409 }
    );
  }

  const section = await db.query.sections.findFirst({
    where: eq(sections.id, sectionId),
  });
  if (!section || section.proposalId !== id) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const version = await db.query.sectionVersions.findFirst({
    where: eq(sectionVersions.id, body.versionId),
  });
  if (!version || version.sectionId !== sectionId) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  await db
    .update(sections)
    .set({
      currentContent: version.content,
      needsInput: version.needsInput,
      currentVersionId: version.id,
      updatedAt: new Date(),
    })
    .where(eq(sections.id, sectionId));

  await db.insert(events).values({
    proposalId: id,
    eventType: "section_edited",
    detail: `${section.sectionKey} restored to an earlier ${version.generatedBy === "ai" ? "AI-generated" : "human-edited"} version by ${user.name}`,
  });

  await trackOwnershipPickup({
    proposal,
    actingUser: user,
    actionLabel: `restored ${section.sectionKey}`,
  });

  return NextResponse.json({ ok: true, content: version.content, needsInput: version.needsInput });
}
