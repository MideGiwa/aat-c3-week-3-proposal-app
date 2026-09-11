"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { INTAKE_FIELDS } from "@/lib/proposal-fields";

export default function NewProposalPage() {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);

    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setErrors(
        data.missing
          ? data.missing.map((k: string) => `Missing required field: ${k}`)
          : [data.error || "Something went wrong"]
      );
      return;
    }

    router.push(`/proposals/${data.proposal.id}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6 border-b border-zinc-200 pb-5">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">New proposal intake</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Fields marked * are required. Leave anything else blank if it wasn&rsquo;t covered on
          the call — the system will flag any section that depends on it as needing input
          rather than guessing.
        </p>
      </div>

      {errors.length > 0 && (
        <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <ul className="list-disc pl-4">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {INTAKE_FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-zinc-700">
              {field.label}
              {field.required && <span className="text-red-500"> *</span>}
            </span>
            {["client_needs_summary", "project_scope", "goals_and_objectives", "recommended_services"].includes(
              field.key
            ) ? (
              <textarea
                rows={3}
                className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 placeholder:text-zinc-400"
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            ) : (
              <input
                type={field.key === "client_email" ? "email" : field.key === "date_of_call" ? "date" : "text"}
                className="rounded-md border border-zinc-300 px-3 py-2 text-zinc-900 placeholder:text-zinc-400"
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            )}
          </label>
        ))}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create proposal"}
        </button>
      </form>
    </div>
  );
}
