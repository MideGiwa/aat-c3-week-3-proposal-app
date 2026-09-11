import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { readDocumentFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/documents/:documentId/download — deliberately does NOT require
// the internal sign-in cookie: this is the link a client (who has no
// account in this app) receives by email, per client-email-template.md's
// {{proposal_link}}. Security here is an unguessable UUID rather than
// auth, which is a reasonable tradeoff for this stage of the build but a
// known gap — see README — since it has no expiry or revocation.
// Turns "Acme, Inc." into "Acme Inc" — Content-Disposition's plain
// `filename=` parameter is unreliable outside a narrow safe set of ASCII
// characters (quotes, backslashes, and non-ASCII bytes are all liable to be
// mangled or rejected by one browser or another), so this strips anything
// outside letters/digits/spaces/hyphens rather than trying to escape it.
function sanitizeForFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks left by NFKD decomposition
    .replace(/[^a-zA-Z0-9 -]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
    with: { proposal: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // A human-readable name ("Proposal - Acme Inc - Jane Doe.pdf") instead of
  // the previous "proposal-<uuid>.pdf" — this is what a client actually
  // sees as the saved filename once they download it, and a random id
  // there was never meant as the final, client-facing name for the
  // document itself, just how it was addressed internally in storage.
  const company = sanitizeForFilename(doc.proposal.companyName);
  const client = sanitizeForFilename(doc.proposal.clientName);
  const readableName = ["Proposal", company, client].filter(Boolean).join(" - ") || `proposal-${doc.proposalId}`;
  // filename= carries the sanitized ASCII fallback for older clients;
  // filename* (RFC 5987/6266) carries the exact original name, percent-
  // encoded, for clients that honor it — so a client/company name with
  // accents or other non-ASCII characters isn't silently dropped, just
  // not what a very old client falls back to.
  const rawName = ["Proposal", doc.proposal.companyName, doc.proposal.clientName].filter(Boolean).join(" - ");

  try {
    const buffer = await readDocumentFile(doc.storagePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": doc.kind === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${readableName}.${doc.kind}"; filename*=UTF-8''${encodeURIComponent(`${rawName}.${doc.kind}`)}`,
        "Cache-Control": "private, max-age=0, no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "Document file is not available" }, { status: 404 });
  }
}
