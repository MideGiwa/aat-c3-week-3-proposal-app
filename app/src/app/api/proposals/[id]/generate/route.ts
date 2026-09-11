import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, sections, sectionVersions, events, attachments } from "@/lib/db/schema";
import { contentNeedsInput } from "@/lib/proposal-fields";
import { generateProposalSections, GenerationError } from "@/lib/anthropic";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/proposals/:id/generate — the core AI Generation Service call
// (architecture.md 3.3). Fills every section from intake + any supporting
// material, flags sections Claude marked as needing input, and records a
// generation_succeeded/generation_failed event either way so failures are
// debuggable (PRD scenario 7) rather than a silent stuck "draft".
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
    with: { intakeFields: true },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const materials = await db
    .select()
    .from(attachments)
    .where(eq(attachments.proposalId, id));

  await db.insert(events).values({
    proposalId: id,
    eventType: "generation_started",
    detail: `Requested by ${user.name}`,
  });

  const intake = Object.fromEntries(
    proposal.intakeFields.map((f) => [f.fieldKey, f.fieldValue])
  );
  const supportingMaterial = materials
    .filter((m) => m.extractedText)
    .map((m) => ({ filename: m.filename, extractedText: m.extractedText! }));

  try {
    const generated = await generateProposalSections({ intake, supportingMaterial });

    const existingSections = await db
      .select()
      .from(sections)
      .where(eq(sections.proposalId, id));

    for (const section of existingSections) {
      const content = generated[section.sectionKey];
      if (content === undefined) continue;
      const needsInput = contentNeedsInput(content);

      const [version] = await db
        .insert(sectionVersions)
        .values({ sectionId: section.id, content, generatedBy: "ai", needsInput })
        .returning();
      await db
        .update(sections)
        .set({
          currentContent: content,
          needsInput,
          currentVersionId: version.id,
          updatedAt: new Date(),
        })
        .where(eq(sections.id, section.id));
    }

    await db.insert(events).values({
      proposalId: id,
      eventType: "generation_succeeded",
      detail: null,
    });
    await db
      .update(proposals)
      .set({ status: "draft", lastError: null, updatedAt: new Date() })
      .where(eq(proposals.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    const reason =
      err instanceof GenerationError ? `${err.kind}: ${err.message}` : String(err);

    await db.insert(events).values({
      proposalId: id,
      eventType: "generation_failed",
      detail: reason,
    });
    await db
      .update(proposals)
      .set({ status: "generation_failed", lastError: reason, updatedAt: new Date() })
      .where(eq(proposals.id, id));

    return NextResponse.json({ error: "Generation failed", detail: reason }, { status: 502 });
  }
}
