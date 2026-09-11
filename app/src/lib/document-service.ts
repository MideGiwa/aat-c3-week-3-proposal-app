import { eq } from "drizzle-orm";
import { db } from "./db";
import { documents, proposals } from "./db/schema";
import { renderProposalPdf } from "./pdf";
import { saveDocumentFile } from "./storage";
import { SECTION_DEFS } from "./proposal-fields";

export class DocumentGenerationError extends Error {}

// Builds the final PDF from whatever the sections currently say — called
// both from the standalone "generate document" action and, unconditionally,
// right before every send, so what actually reaches the client can never be
// a stale preview from before a late edit (architecture.md 3.6).
export async function generateProposalDocument(
  proposalId: string
): Promise<{ id: string; storagePath: string }> {
  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, proposalId),
    with: { currentOwner: true, sections: true },
  });
  if (!proposal) throw new DocumentGenerationError("Proposal not found");

  const order = SECTION_DEFS.map((s) => s.key);
  const sorted = [...proposal.sections].sort(
    (a, b) => order.indexOf(a.sectionKey) - order.indexOf(b.sectionKey)
  );

  const incomplete = sorted.filter((s) => !s.currentContent.trim());
  if (incomplete.length > 0) {
    throw new DocumentGenerationError(
      `Cannot generate document — still empty: ${incomplete.map((s) => s.sectionKey).join(", ")}`
    );
  }

  const pdfBuffer = await renderProposalPdf({
    clientName: proposal.clientName,
    companyName: proposal.companyName,
    // The document credits whoever is currently responsible for the
    // proposal, not necessarily whoever originally created it — a proposal
    // picked up by another salesperson should show *their* name to the
    // client, not the original creator's.
    salespersonName: proposal.currentOwner.name,
    dateOfCall: proposal.dateOfCall,
    sections: sorted.map((s) => ({
      title: SECTION_DEFS.find((d) => d.key === s.sectionKey)!.title,
      content: s.currentContent,
    })),
  });

  // Insert first to get an id (used as the filename), then fill in the
  // storage path — keeps the row and the file's name in lockstep.
  const [doc] = await db
    .insert(documents)
    .values({
      proposalId,
      kind: "pdf",
      storagePath: "",
      sectionVersionIds: sorted.map((s) => s.currentVersionId).filter((v): v is string => !!v),
    })
    .returning();

  const storagePath = await saveDocumentFile(proposalId, doc.id, pdfBuffer, "pdf");
  await db.update(documents).set({ storagePath }).where(eq(documents.id, doc.id));

  return { id: doc.id, storagePath };
}
