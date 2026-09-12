import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/users/:id/remove — revokes a team member's access. This is a
// soft delete (status -> "removed"), never a row delete: proposals,
// approvals, and events reference users by id with no cascade, on purpose
// (architecture.md), so a real delete would either fail outright or leave
// history pointing at a user that no longer exists. getCurrentUser() and
// the login route already refuse anything but status "active", so flipping
// this one column is what actually locks the person out — nothing else
// needs to change. See /reactivate to undo this.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (currentUser.role !== "approver") {
    return NextResponse.json({ error: "Only an approver can remove a team member" }, { status: 403 });
  }
  if (id === currentUser.id) {
    return NextResponse.json({ error: "You can't remove your own account" }, { status: 400 });
  }

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.status === "removed") {
    return NextResponse.json({ error: "This person has already been removed" }, { status: 409 });
  }

  // An approver is the only role that can invite/approve/remove anyone at
  // all — removing the last active one would lock the whole team out of
  // those actions with no way back in (reactivating them again needs an
  // approver too). Only counts active approvers: one who's merely
  // "invited" can't act as an approver yet anyway.
  if (target.role === "approver" && target.status === "active") {
    const otherActiveApprovers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "approver"), eq(users.status, "active"), ne(users.id, target.id)));
    if (otherActiveApprovers.length === 0) {
      return NextResponse.json(
        { error: "Can't remove the last active approver — invite or reactivate another approver first" },
        { status: 409 }
      );
    }
  }

  await db
    .update(users)
    .set({ status: "removed", removedAt: new Date(), removedBy: currentUser.id })
    .where(eq(users.id, id));

  return NextResponse.json({ ok: true });
}
