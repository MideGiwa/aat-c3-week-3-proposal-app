import { NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, sectionVersions } from "@/lib/db/schema";
import { SECTION_DEFS } from "@/lib/proposal-fields";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
    with: {
      salesperson: true,
      currentOwner: true,
      intakeFields: true,
      sections: {
        with: { versions: { orderBy: [asc(sectionVersions.createdAt)] } },
      },
      attachments: true,
      approvals: { with: { reviewer: true } },
      events: { orderBy: (e, { desc }) => [desc(e.createdAt)] },
      documents: true,
    },
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // Sort sections into the fixed template order rather than insertion order.
  const order = SECTION_DEFS.map((s) => s.key);
  const sortedSections = [...proposal.sections].sort(
    (a, b) => order.indexOf(a.sectionKey) - order.indexOf(b.sectionKey)
  );

  return NextResponse.json({ proposal: { ...proposal, sections: sortedSections } });
}
