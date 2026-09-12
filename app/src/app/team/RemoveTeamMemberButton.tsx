"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Two-step (click, then confirm) rather than a native `confirm()` dialog —
// removing someone revokes their access immediately, so it deserves a
// deliberate second click, but a blocking browser dialog isn't worth the
// inconsistency with the rest of this app's UI.
export function RemoveTeamMemberButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/remove`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not remove this person");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this person");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => setConfirming(true)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
        >
          Remove
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-600">Remove {name}?</span>
        <button
          onClick={remove}
          disabled={busy}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Removing…" : "Confirm"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
