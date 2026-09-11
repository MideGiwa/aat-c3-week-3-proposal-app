"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResendInviteButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/resend-invite`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not resend the invite");
      setSent(true);
      setDevLink(body.devSetupLink ?? null);
      if (body.emailError) setError(`Re-issued, but the email failed to send: ${body.emailError}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resend the invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={resend}
        disabled={busy}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
      >
        {busy ? "Resending…" : sent ? "Resent" : "Resend invite"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {devLink && (
        <a href={devLink} className="text-xs text-zinc-400 underline hover:text-zinc-600">
          Local dev — open setup link
        </a>
      )}
    </div>
  );
}
