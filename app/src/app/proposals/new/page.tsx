"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { INTAKE_FIELDS } from "@/lib/proposal-fields";
import { SUPPORTED_EXTRACTION_LABEL } from "@/lib/attachment-extraction";

export default function NewProposalPage() {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    if (!res.ok) {
      setSubmitting(false);
      setErrors(
        data.missing
          ? data.missing.map((k: string) => `Missing required field: ${k}`)
          : [data.error || "Something went wrong"]
      );
      return;
    }

    // Supporting material is optional and shouldn't block getting into the
    // editor if it fails to attach — the proposal itself was already
    // created successfully above, so a partial failure here surfaces as a
    // (skippable) error rather than losing the whole submission.
    const files = fileInputRef.current?.files;
    if (files && files.length > 0) {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const uploadRes = await fetch(`/api/proposals/${data.proposal.id}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!uploadRes.ok) {
        const uploadData = await uploadRes.json().catch(() => ({}));
        setSubmitting(false);
        setErrors([
          `Proposal created, but the attached file(s) failed to upload: ${uploadData.error || "unknown error"}. You can add them from the proposal page instead.`,
        ]);
        // Still worth going straight to the proposal rather than stranding
        // the salesperson on a form for a proposal that already exists.
        router.push(`/proposals/${data.proposal.id}`);
        return;
      }
    }

    router.push(`/proposals/${data.proposal.id}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href="/proposals"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900"
      >
        ← Back to proposals
      </Link>
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

        <div className="flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <span className="font-medium text-zinc-700">Supporting material (optional)</span>
          <p className="text-xs text-zinc-500">
            Anything from the call worth referencing directly — a scope document, an RFP, notes.
            Claude will use text extracted from these files as extra context when drafting.
            Supported for extraction: {SUPPORTED_EXTRACTION_LABEL}. Other file types are still
            stored and visible on the proposal, just without extracted text.
          </p>
          <input ref={fileInputRef} type="file" multiple className="mt-1 text-sm text-zinc-600" />
        </div>

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
