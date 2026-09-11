"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type StartResponse = { secretBase32: string; otpauthUrl: string; qrDataUrl: string };

export function SetupAuthenticatorForm({ uid, token }: { uid: string; token: string }) {
  const router = useRouter();
  const [data, setData] = useState<StartResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/setup/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, token }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not start setup");
        if (!cancelled) setData(body);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not start setup");
      });
    return () => {
      cancelled = true;
    };
  }, [uid, token]);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await fetch("/api/auth/setup/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, token, code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "That code didn't work");
      router.push("/proposals");
      router.refresh();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "That code didn't work");
      setConfirming(false);
    }
  }

  if (loadError) {
    return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>;
  }

  if (!data) {
    return <p className="text-sm text-zinc-400">Preparing your setup code…</p>;
  }

  const groupedSecret = data.secretBase32.replace(/(.{4})/g, "$1 ").trim();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-200 bg-white p-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- a locally generated data: URL, not an optimizable remote image */}
        <img src={data.qrDataUrl} alt="QR code to scan with your authenticator app" width={200} height={200} />
        <div className="text-center">
          <p className="text-xs text-zinc-400">Can&rsquo;t scan it? Enter this code manually:</p>
          <p className="mt-1 font-mono text-sm tracking-wider text-zinc-700">{groupedSecret}</p>
        </div>
      </div>

      <form onSubmit={confirm} className="flex flex-col gap-3">
        <label htmlFor="totp-code" className="text-sm font-medium text-zinc-700">
          Enter the 6-digit code from your app
        </label>
        <input
          id="totp-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="123456"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-center text-lg tracking-[0.3em] text-zinc-900 placeholder:tracking-normal placeholder:text-zinc-400"
        />
        {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
        <button
          type="submit"
          disabled={confirming || code.length !== 6}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {confirming ? "Activating…" : "Activate & sign in"}
        </button>
      </form>
    </div>
  );
}
