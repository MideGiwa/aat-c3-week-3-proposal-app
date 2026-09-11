import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { proposals, intakeFields, sections, events } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { INTAKE_FIELDS, SECTION_DEFS, missingRequiredFields } from "@/lib/proposal-fields";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/proposals — the central list backing the dashboard.
export async function GET() {
  const rows = await db.query.proposals.findMany({
    orderBy: [desc(proposals.createdAt)],
    with: { salesperson: true },
  });
  return NextResponse.json({ proposals: rows });
}

// POST /api/proposals — create a proposal from intake. Validates required
// fields before anything touches Claude (PRD scenario 2 starts here: an
// incomplete submission is rejected up front rather than silently
// generating fabricated content).
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const missing = missingRequiredFields(body);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Missing required fields", missing },
      { status: 400 }
    );
  }

  const [proposal] = await db
    .insert(proposals)
    .values({
      clientName: body.client_name,
      clientEmail: body.client_email,
      companyName: body.company_name,
      dateOfCall: body.date_of_call || null,
      salespersonId: user.id,
    })
    .returning();

  await db.insert(intakeFields).values(
    INTAKE_FIELDS.map((f) => ({
      proposalId: proposal.id,
      fieldKey: f.key,
      fieldValue: (body[f.key] ?? "").toString(),
    }))
  );

  await db.insert(sections).values(
    SECTION_DEFS.map((s) => ({
      proposalId: proposal.id,
      sectionKey: s.key,
      currentContent: "",
      needsInput: true,
    }))
  );

  await db.insert(events).values({
    proposalId: proposal.id,
    eventType: "proposal_created",
    detail: `Created by ${user.name}`,
  });

  return NextResponse.json({ proposal }, { status: 201 });
}
