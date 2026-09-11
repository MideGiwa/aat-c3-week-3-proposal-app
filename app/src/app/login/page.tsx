"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type User = { id: string; name: string; email: string; role: string };

export default function LoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((data) => setUsers(data.users))
      .catch(() => setError("Could not reach the database. Is DATABASE_URL configured?"));
  }, []);

  async function signInAs(userId: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      router.push("/proposals");
      router.refresh();
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-20 sm:py-28">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-xs font-semibold text-white">
          KT
        </span>
        <div>
          <h1 className="text-base font-medium text-zinc-900">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-500">Pick a seeded account to continue.</p>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
        {users?.map((u) => (
          <button
            key={u.id}
            onClick={() => signInAs(u.id)}
            className="flex items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-zinc-50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium text-zinc-600">
              {initials(u.name)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-900">{u.name}</div>
              <div className="truncate text-xs text-zinc-500">
                {u.email} · {u.role}
              </div>
            </div>
          </button>
        ))}
        {users?.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            No users seeded yet. Run <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">npm run seed</code>.
          </p>
        )}
        {users === null && !error && (
          <p className="px-4 py-8 text-center text-sm text-zinc-400">Loading…</p>
        )}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
