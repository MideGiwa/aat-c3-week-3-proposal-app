"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReactivateTeamMemberButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reactivate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${userId}/reactivate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not reactivate this person");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reactivate this person");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={reactivate}
        disabled={busy}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
      >
        {busy ? "Reactivating…" : "Reactivate"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
