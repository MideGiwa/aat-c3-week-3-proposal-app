import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals, users, events } from "@/lib/db/schema";

// The user's brief: proposals should default to showing only the logged-in
// salesperson's own work, but any salesperson can pick up someone else's —
// as long as it's tracked and auditable. There's deliberately no manual
// "take over" button: no route restricts editing to the current owner (any
// signed-in salesperson can already act on any proposal), so "picking up"
// happens naturally the moment someone other than the current owner does
// real work on it. This just makes that handoff visible: it updates
// `currentOwnerId` (what drives the "Mine" filter on /proposals) and writes
// a dedicated `ownership_changed` event distinct from the routine
// section_edited/attachment_added/etc. entries, so a hand-off is never
// buried in the timeline as an unremarkable edit.
//
// `salespersonId` (the original creator) is never touched here — that stays
// permanent regardless of how many times a proposal changes hands.
export async function trackOwnershipPickup(params: {
  proposal: { id: string; currentOwnerId: string };
  actingUser: { id: string; name: string; role: string };
  actionLabel: string;
}): Promise<void> {
  const { proposal, actingUser, actionLabel } = params;

  // Only a salesperson's own actions count as "picking up work" — an
  // approver reviewing or acting on a proposal isn't taking over the
  // salesperson's job, so it shouldn't reassign it.
  if (actingUser.role !== "salesperson") return;
  if (proposal.currentOwnerId === actingUser.id) return;

  const previousOwner = await db.query.users.findFirst({
    where: eq(users.id, proposal.currentOwnerId),
  });

  await db
    .update(proposals)
    .set({ currentOwnerId: actingUser.id })
    .where(eq(proposals.id, proposal.id));

  await db.insert(events).values({
    proposalId: proposal.id,
    eventType: "ownership_changed",
    detail: `${actingUser.name} picked up this proposal from ${previousOwner?.name ?? "a previous owner"} (${actionLabel})`,
  });
}
