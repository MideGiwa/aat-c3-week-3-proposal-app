import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, attachments, events } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Text-based formats we can extract inline today. Anything else (PDF,
// DOCX) is stored with a filename but no extracted text yet — a clearly
// scoped follow-up (a PDF/DOCX text extraction step) rather than a silent
// gap, since generation only uses what's in `extractedText`.
const TEXT_EXTENSIONS = [".txt", ".md", ".csv"];

function canExtractText(filename: string): boolean {
  return TEXT_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext));
}

// POST /api/proposals/:id/attachments — upload supporting material
// (PRD scenario 3). multipart/form-data with one or more `files` entries.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const created = [];
  for (const file of files) {
    const extractedText = canExtractText(file.name)
      ? await file.text()
      : null;

    const [row] = await db
      .insert(attachments)
      .values({
        proposalId: id,
        filename: file.name,
        mimeType: file.type || null,
        extractedText,
      })
      .returning();
    created.push(row);
  }

  await db.insert(events).values({
    proposalId: id,
    eventType: "attachment_added",
    detail: `${user.name} uploaded: ${files.map((f) => f.name).join(", ")}`,
  });

  return NextResponse.json({ attachments: created }, { status: 201 });
}
