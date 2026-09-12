"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Same two-step (click, then confirm) pattern as RemoveTeamMemberButton —
// a role change is a real access-control change (who can approve, invite,
// and remove people), not a cosmetic label, so it gets the same deliberate
// second click rather than firing on the first one.
export function ChangeRoleButton({
  userId,
  currentRole,
}: {
  userId: string;
  currentRole: "salesperson" | "approver";
}) {
  const router = useRouter();
  const nextRole = currentRole === "approver" ? "salesperson" : "approver";
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeRole() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not change this person's role");
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change this person's role");
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
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          Make {nextRole}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-600">Make {nextRole}?</span>
        <button
          onClick={changeRole}
          disabled={busy}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
        >
          {busy ? "Changing…" : "Confirm"}
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
