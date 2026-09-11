import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, intakeFields } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { INTAKE_FIELDS, missingRequiredFields, isEditableStatus } from "@/lib/proposal-fields";

export const dynamic = "force-dynamic";

// PATCH /api/proposals/:id/intake — edit the original call-intake values
// (client needs summary, project scope, etc.) after the proposal already
// exists. Before this route existed, the intake form only ever wrote once,
// at creation, and nothing on the detail page let a salesperson see or fix
// those notes again — so "resuming a draft" only ever meant looking at
// empty/generated sections, never the call notes the sections come from.
// Enforced server-side, same as every other mutation here: the UI hides the
// form once a proposal leaves draft/changes_requested/generation_failed,
// but that's not the actual guard.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const proposal = await db.query.proposals.findFirst({ where: eq(proposals.id, id) });
  if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  if (!isEditableStatus(proposal.status)) {
    return NextResponse.json(
      { error: `Cannot edit intake details while status is "${proposal.status}"` },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.fields !== "object" || body.fields === null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const validKeys = new Set<string>(INTAKE_FIELDS.map((f) => f.key));
  const updates = Object.entries(body.fields as Record<string, unknown>).filter(
    (entry): entry is [string, string] => validKeys.has(entry[0]) && typeof entry[1] === "string"
  );
  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // The intake as a whole must still satisfy the same required-field check
  // the original submission did, so editing can't be used to blank out a
  // required field and leave the proposal stuck.
  const currentRows = await db.query.intakeFields.findMany({ where: eq(intakeFields.proposalId, id) });
  const merged: Record<string, string> = Object.fromEntries(currentRows.map((r) => [r.fieldKey, r.fieldValue]));
  for (const [key, value] of updates) merged[key] = value;
  const missing = missingRequiredFields(merged);
  if (missing.length > 0) {
    return NextResponse.json({ error: "Missing required fields", missing }, { status: 400 });
  }

  for (const [key, value] of updates) {
    await db
      .update(intakeFields)
      .set({ fieldValue: value })
      .where(and(eq(intakeFields.proposalId, id), eq(intakeFields.fieldKey, key)));
  }

  return NextResponse.json({ ok: true, fields: merged });
}
