import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/login — placeholder sign-in described in src/lib/auth.ts:
// pick a seeded user, no password. Replace before this is anything but an
// internal course project.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
  if (!user) {
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }

  const res = NextResponse.json({ user });
  res.cookies.set(AUTH_COOKIE_NAME, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

// GET /api/auth/login — list sign-in-able users for the login page.
export async function GET() {
  const rows = await db.select().from(users);
  return NextResponse.json({ users: rows });
}
