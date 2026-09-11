"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InviteTeamForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"salesperson" | "approver">("salesperson");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not send the invite");
      setSuccess(
        body.emailError
          ? `${name.trim()} was added, but the invite email failed to send (${body.emailError}). Use Resend invite below to try again.`
          : `Invite sent to ${email.trim()}.`
      );
      setDevLink(body.devSetupLink ?? null);
      setName("");
      setEmail("");
      setRole("salesperson");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5 sm:flex-row sm:items-end sm:flex-wrap"
    >
      <div className="flex flex-col gap-1.5 sm:flex-1 sm:min-w-[160px]">
        <label htmlFor="invite-name" className="text-sm font-medium text-zinc-700">
          Name
        </label>
        <input
          id="invite-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jordan Lee"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-1 sm:min-w-[200px]">
        <label htmlFor="invite-email" className="text-sm font-medium text-zinc-700">
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jordan@company.com"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-role" className="text-sm font-medium text-zinc-700">
          Role
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value as "salesperson" | "approver")}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
        >
          <option value="salesperson">Salesperson</option>
          <option value="approver">Approver</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 sm:self-end"
      >
        {busy ? "Sending…" : "Send invite"}
      </button>
      {(error || success) && (
        <p className={`w-full text-sm ${error ? "text-red-600" : "text-teal-700"}`}>{error || success}</p>
      )}
      {devLink && (
        <p className="w-full break-all text-xs text-zinc-400">
          Local dev only —{" "}
          <a href={devLink} className="underline hover:text-zinc-600">
            open the setup link
          </a>
        </p>
      )}
    </form>
  );
}
