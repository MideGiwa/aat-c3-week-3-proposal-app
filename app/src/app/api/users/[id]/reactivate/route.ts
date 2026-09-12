import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/users/:id/reactivate — undoes /remove. Restores status ->
// "active" directly rather than routing back through "invited": a removed
// user already finished authenticator setup once and their totpSecret was
// never cleared, so they can sign back in immediately with the same
// authenticator app the moment this flips, no new invite link needed.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (currentUser.role !== "approver") {
    return NextResponse.json({ error: "Only an approver can reactivate a team member" }, { status: 403 });
  }

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.status !== "removed") {
    return NextResponse.json({ error: "This person hasn't been removed" }, { status: 409 });
  }

  await db
    .update(users)
    .set({ status: "active", removedAt: null, removedBy: null })
    .where(eq(users.id, id));

  return NextResponse.json({ ok: true });
}
