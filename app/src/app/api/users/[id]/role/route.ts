import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/users/:id/role — flips a team member between salesperson and
// approver. Only an approver can do this (same reasoning as invite/remove:
// deciding who can approve proposals shouldn't be something a salesperson
// can grant themselves). Self-changes are allowed — an approver can step
// down to salesperson — but subject to the same "don't lock the team out"
// guard as removal: if this would demote the last active approver, it's
// refused instead of silently leaving nobody able to approve, invite, or
// undo anything.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (currentUser.role !== "approver") {
    return NextResponse.json({ error: "Only an approver can change a team member's role" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const role = body?.role as "salesperson" | "approver" | undefined;
  if (role !== "salesperson" && role !== "approver") {
    return NextResponse.json({ error: "Role must be salesperson or approver" }, { status: 400 });
  }

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (target.role === role) {
    return NextResponse.json(
      { error: `This person is already ${role === "approver" ? "an" : "a"} ${role}` },
      { status: 409 }
    );
  }

  // Demoting an active approver away from the role needs the same check
  // /remove uses: at least one other active approver has to remain,
  // otherwise nobody left could invite, approve, or undo anything —
  // including reversing this exact change.
  if (target.role === "approver" && target.status === "active") {
    const otherActiveApprovers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "approver"), eq(users.status, "active"), ne(users.id, target.id)));
    if (otherActiveApprovers.length === 0) {
      return NextResponse.json(
        { error: "Can't change the last active approver's role — invite or reactivate another approver first" },
        { status: 409 }
      );
    }
  }

  await db
    .update(users)
    .set({ role, roleChangedAt: new Date(), roleChangedBy: currentUser.id })
    .where(eq(users.id, id));

  return NextResponse.json({ ok: true });
}
