"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type DevUser = { id: string; name: string; email: string; role: string };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [devUsers, setDevUsers] = useState<DevUser[] | null>(null);
  const [devLoginEnabled, setDevLoginEnabled] = useState(false);
  const [devSigningInId, setDevSigningInId] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((data) => {
        setDevLoginEnabled(Boolean(data.devLoginEnabled));
        setDevUsers(data.users ?? []);
      })
      .catch(() => {
        // The dev quick-switch list is a convenience, not core
        // functionality — if it can't load, the real email+code form
        // below still works, so this fails silently rather than showing
        // an error for a feature most users (production, always) don't
        // even have.
        setDevUsers([]);
      });
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Sign-in failed");
      router.push("/proposals");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setSubmitting(false);
    }
  }

  async function devSignInAs(userId: string) {
    setDevSigningInId(userId);
    setDevError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not sign in as that user");
      }
      router.push("/proposals");
      router.refresh();
    } catch (e) {
      setDevError(e instanceof Error ? e.message : "Could not sign in as that user");
      setDevSigningInId(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-8 px-6 py-20 sm:py-28">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600 text-xs font-semibold text-white">
          KT
        </span>
        <div>
          <h1 className="text-base font-medium text-zinc-900">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-500">Enter your email and the code from your authenticator app.</p>
        </div>
      </div>

      <form onSubmit={signIn} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-zinc-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className="text-sm font-medium text-zinc-700">
            Authenticator code
          </label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-center text-lg tracking-[0.3em] text-zinc-900 placeholder:tracking-normal placeholder:text-zinc-400"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-xs text-zinc-400">
          No account yet? An approver on your team can invite you by email.
        </p>
      </form>

      {devLoginEnabled && devUsers && devUsers.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
            Local dev quick sign-in
          </p>
          <div className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-dashed border-zinc-300 bg-white">
            {devUsers.map((u) => {
              const signingIn = devSigningInId === u.id;
              return (
                <button
                  key={u.id}
                  disabled={devSigningInId !== null}
                  onClick={() => devSignInAs(u.id)}
                  className="flex items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-zinc-50 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium text-zinc-600">
                    {initials(u.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-900">
                      {u.name}
                      {signingIn && <span className="font-normal text-zinc-500"> — Signing in…</span>}
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {u.email} · {u.role}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {devError && <p className="text-center text-sm text-red-600">{devError}</p>}
        </div>
      )}
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
