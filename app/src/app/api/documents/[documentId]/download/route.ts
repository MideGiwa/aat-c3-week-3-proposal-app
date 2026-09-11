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
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;

  const doc = await db.query.documents.findFirst({ where: eq(documents.id, documentId) });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    const buffer = await readDocumentFile(doc.storagePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": doc.kind === "pdf" ? "application/pdf" : "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="proposal-${doc.proposalId}.${doc.kind}"`,
        "Cache-Control": "private, max-age=0, no-cache",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Document file is not available (it may have been generated on a different server instance — see README's note on local-disk storage)" },
      { status: 404 }
    );
  }
}
