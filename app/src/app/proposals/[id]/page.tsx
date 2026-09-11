import { notFound, redirect } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, sectionVersions } from "@/lib/db/schema";
import { SECTION_DEFS } from "@/lib/proposal-fields";
import { getCurrentUser } from "@/lib/auth";
import { ProposalEditor } from "./ProposalEditor";

export const dynamic = "force-dynamic";

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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
      documents: { orderBy: (d, { desc }) => [desc(d.createdAt)] },
    },
  });

  if (!proposal) notFound();

  const order = SECTION_DEFS.map((s) => s.key);
  const sortedSections = [...proposal.sections].sort(
    (a, b) => order.indexOf(a.sectionKey) - order.indexOf(b.sectionKey)
  );

  // Serialize dates for the client component boundary.
  const serialized = {
    ...proposal,
    sections: sortedSections,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    events: proposal.events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    documents: proposal.documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
  };

  return (
    <ProposalEditor
      proposal={JSON.parse(JSON.stringify(serialized))}
      currentUser={{ id: user.id, name: user.name, role: user.role }}
    />
  );
}
