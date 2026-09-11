"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SECTION_DEFS, SectionKey, STATUS_LABEL, STATUS_DOT, INTAKE_FIELDS, isEditableStatus } from "@/lib/proposal-fields";
import { StatusStepper } from "@/components/StatusStepper";
import { MarkdownLite } from "@/components/MarkdownLite";
import { SUPPORTED_EXTRACTION_LABEL } from "@/lib/attachment-extraction";

type SectionVersionData = {
  id: string;
  content: string;
  generatedBy: "ai" | "human";
  needsInput: boolean;
  createdAt: string;
};

type SectionData = {
  id: string;
  sectionKey: SectionKey;
  currentContent: string;
  needsInput: boolean;
  currentVersionId: string | null;
  versions: SectionVersionData[];
};

type EventData = { id: string; eventType: string; detail: string | null; createdAt: string };

type DocumentData = { id: string; kind: string; createdAt: string };

type ProposalData = {
  id: string;
  clientName: string;
  clientEmail: string;
  companyName: string;
  status: string;
  lastError: string | null;
  salesperson: { id: string; name: string; email: string };
  currentOwner: { id: string; name: string; email: string };
  intakeFields: { fieldKey: string; fieldValue: string }[];
  sections: SectionData[];
  attachments: { id: string; filename: string; extractedText: string | null }[];
  approvals: {
    id: string;
    decision: string;
    comment: string | null;
    decidedAt: string;
    undoneAt: string | null;
    reviewer: { name: string; email: string };
  }[];
  events: EventData[];
  documents: DocumentData[];
};

type CurrentUser = { id: string; name: string; role: string };

// A color per activity type, so the timeline reads at a glance instead of as
// a wall of identical gray text — loosely grouped: gray for informational,
// blue for generation/documents, violet/purple for section-content changes,
// amber/orange for review states, green for positive outcomes, red for
// failures/rejection.
const EVENT_META: Record<string, { label: string; dot: string }> = {
  proposal_created: { label: "Proposal created", dot: "bg-zinc-400" },
  generation_started: { label: "Generation started", dot: "bg-blue-400" },
  generation_succeeded: { label: "Proposal generated", dot: "bg-blue-500" },
  generation_failed: { label: "Generation failed", dot: "bg-red-500" },
  section_edited: { label: "Section edited", dot: "bg-violet-500" },
  section_regenerated: { label: "Section regenerated", dot: "bg-purple-500" },
  attachment_added: { label: "File uploaded", dot: "bg-zinc-400" },
  submitted_for_review: { label: "Submitted for review", dot: "bg-amber-500" },
  approved: { label: "Approved", dot: "bg-green-500" },
  rejected: { label: "Rejected", dot: "bg-red-500" },
  changes_requested: { label: "Changes requested", dot: "bg-orange-500" },
  approval_undone: { label: "Approval undone", dot: "bg-amber-500" },
  ownership_changed: { label: "Picked up by someone else", dot: "bg-teal-500" },
  document_generated: { label: "Document generated", dot: "bg-blue-500" },
  document_failed: { label: "Document failed", dot: "bg-red-500" },
  sent: { label: "Sent to client", dot: "bg-green-500" },
  send_failed: { label: "Send failed", dot: "bg-red-500" },
};

// Grows a textarea to fit its content instead of scrolling internally, so
// editable sections read like part of a continuous document rather than a
// small form control dropped into one.
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function ProposalEditor({
  proposal,
  currentUser,
}: {
  proposal: ProposalData;
  currentUser: CurrentUser;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(proposal.sections.map((s) => [s.id, s.currentContent]))
  );
  const [showChangesForm, setShowChangesForm] = useState(false);
  const [changesComment, setChangesComment] = useState("");
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [hasFileSelected, setHasFileSelected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The call notes a proposal was created from — separate from `drafts`
  // (the generated sections) because they come from a different table and
  // save through a different endpoint. Shown so that reopening a draft
  // means picking up the whole picture, not just whatever Claude produced
  // (or didn't) from it.
  const intakeValues = Object.fromEntries(proposal.intakeFields.map((f) => [f.fieldKey, f.fieldValue]));
  const [intakeDrafts, setIntakeDrafts] = useState<Record<string, string>>(intakeValues);
  const [intakeOpen, setIntakeOpen] = useState(
    !proposal.sections.some((s) => s.currentContent.trim())
  );
  const intakeDirty = INTAKE_FIELDS.some((f) => (intakeDrafts[f.key] ?? "") !== (intakeValues[f.key] ?? ""));

  // Mirrors the cc list the send route actually builds server-side (latest
  // "approved" decision's reviewer, plus the salesperson, deduped against
  // each other and against the client's own address) so the confirmation
  // modal shows exactly who is about to be copied rather than just who the
  // email is addressed to.
  const latestApproval = [...proposal.approvals]
    .filter((a) => a.decision === "approved" && !a.undoneAt)
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime())[0];
  const sendCcEmails = Array.from(
    new Set(
      [proposal.currentOwner.email, latestApproval?.reviewer.email].filter(
        (email): email is string => !!email && email !== proposal.clientEmail
      )
    )
  );

  // Every action either shows a red error box or, previously, nothing at
  // all on success — refreshing the page silently was easy to mistake for
  // "did that actually work?". Show a brief positive acknowledgment instead.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // Sending is the one action here that immediately puts a real email in a
  // client's inbox — worth an explicit "is this who/what you meant to send"
  // check rather than firing on the first click, the way every other action
  // in this editor does. Escape closes it like any other dialog, but only
  // while nothing is in flight — a request already underway shouldn't be
  // dismissable out from under itself.
  useEffect(() => {
    if (!showSendConfirm) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && busy === null) setShowSendConfirm(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSendConfirm, busy]);

  async function confirmSend() {
    await run("send", () => call(`/api/proposals/${proposal.id}/send`, { method: "POST" }), "Sent to client.");
    setShowSendConfirm(false);
  }

  const hasAnyContent = proposal.sections.some((s) => s.currentContent.trim());
  const completeCount = proposal.sections.filter((s) => s.currentContent.trim() && !s.needsInput).length;
  const sectionsComplete = completeCount === proposal.sections.length;
  const isSalesperson = currentUser.role === "salesperson";
  const isApprover = currentUser.role === "approver";
  const canEdit = isEditableStatus(proposal.status);
  const canSubmit = isSalesperson && (proposal.status === "draft" || proposal.status === "changes_requested");
  const canDecide = isApprover && proposal.status === "pending_review";
  const canSend =
    (proposal.status === "approved" || proposal.status === "send_failed" || proposal.status === "document_failed") &&
    (isSalesperson || isApprover);
  // Only from "approved" itself — once a send has actually been attempted
  // (document_failed/send_failed), there's a document/event trail hanging
  // off that approval that undoing it would leave orphaned, so this window
  // is specifically "approved, but nobody has hit send yet".
  const canUndoApproval = isApprover && proposal.status === "approved";
  const latestDocument = proposal.documents[0];
  const earlierDocuments = proposal.documents.slice(1);

  async function call(url: string, options: RequestInit = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ? `${data.error}${data.detail ? `: ${data.detail}` : ""}` : "Request failed");
    return data;
  }

  async function run(key: string, fn: () => Promise<unknown>, successMessage?: string) {
    setBusy(key);
    setError(null);
    setSuccess(null);
    try {
      await fn();
      if (successMessage) setSuccess(successMessage);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <Link
        href="/proposals"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900"
      >
        ← Back to proposals
      </Link>
      <div className="mb-6 border-b border-zinc-200 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              {proposal.clientName} — {proposal.companyName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
              {proposal.currentOwner.id === proposal.salesperson.id ? (
                <span>Prepared by {proposal.salesperson.name}</span>
              ) : (
                <span>
                  Currently owned by <span className="font-medium text-zinc-700">{proposal.currentOwner.name}</span>{" "}
                  (created by {proposal.salesperson.name})
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 text-zinc-700">
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[proposal.status] ?? "bg-zinc-400"}`} />
                {STATUS_LABEL[proposal.status] ?? proposal.status}
              </span>
            </div>
          </div>
          {!hasAnyContent && canEdit && (
            <button
              disabled={busy !== null}
              onClick={() =>
                run(
                  "generate",
                  async () => {
                    // `drafts` was seeded from `proposal.sections` once, on
                    // mount — router.refresh() below brings back fresh
                    // section content in the `proposal` prop, but that
                    // doesn't touch state that already initialized from an
                    // earlier render. Merge the response directly into
                    // `drafts`, same as regenerate/restore already do,
                    // instead of leaving the textareas showing their
                    // pre-generation (empty) value until a reload remounts
                    // the component.
                    const data = await call(`/api/proposals/${proposal.id}/generate`, { method: "POST" });
                    if (data.sections) {
                      setDrafts((d) => ({ ...d, ...data.sections }));
                    }
                  },
                  "Proposal generated."
                )
              }
              className="shrink-0 rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy === "generate" ? "Generating…" : "Generate proposal"}
            </button>
          )}
        </div>
        <div className="mt-4">
          <StatusStepper status={proposal.status} />
        </div>
      </div>

      {proposal.lastError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Last error: {proposal.lastError}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* Timeline — every event color-coded by type, so what's happened to
            this proposal reads at a glance instead of as a wall of text.
            Sticky on desktop so it stays in view alongside a long document. */}
        <aside className="order-2 w-full shrink-0 lg:order-1 lg:sticky lg:top-6 lg:w-64">
          <h2 className="mb-3 text-sm font-medium text-zinc-900">Timeline</h2>
          {proposal.events.length === 0 ? (
            <p className="text-sm text-zinc-400">Nothing yet.</p>
          ) : (
            <ol className="flex flex-col gap-4 border-l border-zinc-200 pl-4">
              {proposal.events.map((e) => {
                const meta = EVENT_META[e.eventType] ?? { label: e.eventType.replace(/_/g, " "), dot: "bg-zinc-400" };
                return (
                  <li key={e.id} className="relative">
                    <span
                      className={`absolute top-1 h-2 w-2 -translate-x-[21px] rounded-full ring-4 ring-white ${meta.dot}`}
                    />
                    <div className="text-xs text-zinc-400">{new Date(e.createdAt).toLocaleString()}</div>
                    <div className="text-sm font-medium text-zinc-800">{meta.label}</div>
                    {e.detail && <div className="mt-0.5 text-xs leading-snug text-zinc-500">{e.detail}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </aside>

        {/* The document itself: one continuous card, styled to read like a
            preview of the generated proposal rather than a stack of forms. */}
        <div className="order-1 min-w-0 flex-1 lg:order-2">
          {/* The original intake — collapsed once the document has content
              (it's reference material at that point), open by default for a
              fresh draft so resuming one means picking up the actual call
              notes, not a blank-looking document. */}
          <div className="mb-6 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setIntakeOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left sm:px-8"
            >
              <div>
                <h2 className="text-sm font-medium text-zinc-900">Intake details</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  What was captured from the call — {canEdit ? "editable" : "read-only"}.
                </p>
              </div>
              <span className="shrink-0 text-xs font-medium text-zinc-500">{intakeOpen ? "Hide" : "Show"}</span>
            </button>
            {intakeOpen && (
              <div className="divide-y divide-zinc-100 border-t border-zinc-100">
                {INTAKE_FIELDS.map((field) => {
                  const value = intakeDrafts[field.key] ?? "";
                  const isLong = ["client_needs_summary", "project_scope", "goals_and_objectives", "recommended_services"].includes(
                    field.key
                  );
                  return (
                    <div key={field.key} className="px-6 py-4 sm:px-8">
                      <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                        {field.label}
                        {field.required && <span className="text-red-500"> *</span>}
                      </label>
                      {canEdit ? (
                        isLong ? (
                          <textarea
                            ref={autoResize}
                            rows={2}
                            className="w-full -mx-3 resize-none rounded-md border border-transparent bg-transparent px-3 py-2 text-sm leading-relaxed text-zinc-800 transition-colors placeholder:text-zinc-400 hover:border-zinc-200 hover:bg-zinc-50/60 focus:border-zinc-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-200"
                            value={value}
                            onChange={(e) => {
                              setIntakeDrafts((d) => ({ ...d, [field.key]: e.target.value }));
                              autoResize(e.target);
                            }}
                          />
                        ) : (
                          <input
                            type="text"
                            className="w-full -mx-3 rounded-md border border-transparent bg-transparent px-3 py-2 text-sm text-zinc-800 transition-colors placeholder:text-zinc-400 hover:border-zinc-200 hover:bg-zinc-50/60 focus:border-zinc-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-200"
                            value={value}
                            onChange={(e) => setIntakeDrafts((d) => ({ ...d, [field.key]: e.target.value }))}
                          />
                        )
                      ) : (
                        <p className="whitespace-pre-wrap text-sm text-zinc-700">{value || "—"}</p>
                      )}
                    </div>
                  );
                })}
                {canEdit && (
                  <div className="flex items-center gap-3 px-6 py-4 text-xs sm:px-8">
                    <button
                      disabled={!intakeDirty || busy !== null}
                      onClick={() =>
                        run(
                          "intake",
                          () => call(`/api/proposals/${proposal.id}/intake`, { method: "PATCH", body: JSON.stringify({ fields: intakeDrafts }) }),
                          "Intake details saved."
                        )
                      }
                      className="font-medium text-zinc-500 transition-colors hover:text-zinc-900 disabled:opacity-40 disabled:hover:text-zinc-500"
                    >
                      {busy === "intake" ? "Saving…" : "Save intake details"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {hasAnyContent && (
            <div className="mb-4 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-all"
                  style={{ width: `${(completeCount / proposal.sections.length) * 100}%` }}
                />
              </div>
              <span className="whitespace-nowrap text-xs font-medium text-zinc-500">
                {completeCount} of {proposal.sections.length} sections complete
              </span>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="divide-y divide-zinc-100">
              {proposal.sections.map((section) => {
                const def = SECTION_DEFS.find((s) => s.key === section.sectionKey)!;
                const draft = drafts[section.id] ?? "";
                const dirty = draft !== section.currentContent;
                const pastVersions = section.versions
                  .filter((v) => v.id !== section.currentVersionId)
                  .slice()
                  .reverse();
                const historyOpen = openHistory[section.id] ?? false;

                return (
                  <div key={section.id} className="p-6 sm:p-8">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-zinc-900">{def.title}</h2>
                      {section.needsInput && (
                        <span className="inline-flex shrink-0 items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                          Needs input
                        </span>
                      )}
                    </div>

                    {canEdit ? (
                      <textarea
                        ref={autoResize}
                        rows={3}
                        className="w-full -mx-3 resize-none rounded-md border border-transparent bg-transparent px-3 py-2 text-sm leading-relaxed text-zinc-800 transition-colors placeholder:text-zinc-400 hover:border-zinc-200 hover:bg-zinc-50/60 focus:border-zinc-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-200"
                        value={draft}
                        placeholder="Not generated yet."
                        onChange={(e) => {
                          setDrafts((d) => ({ ...d, [section.id]: e.target.value }));
                          autoResize(e.target);
                        }}
                      />
                    ) : (
                      <MarkdownLite content={section.currentContent} />
                    )}

                    {canEdit && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                        <button
                          disabled={!dirty || busy !== null}
                          onClick={() =>
                            run(
                              `save-${section.id}`,
                              () =>
                                call(`/api/proposals/${proposal.id}/sections/${section.id}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ content: draft }),
                                }),
                              "Section saved."
                            )
                          }
                          className="font-medium text-zinc-500 transition-colors hover:text-zinc-900 disabled:opacity-40 disabled:hover:text-zinc-500"
                        >
                          {busy === `save-${section.id}` ? "Saving…" : "Save edit"}
                        </button>
                        <span className="text-zinc-300">·</span>
                        <button
                          disabled={busy !== null}
                          onClick={() =>
                            run(
                              `regen-${section.id}`,
                              async () => {
                                const data = await call(
                                  `/api/proposals/${proposal.id}/sections/${section.id}/regenerate`,
                                  { method: "POST", body: JSON.stringify({}) }
                                );
                                setDrafts((d) => ({ ...d, [section.id]: data.content }));
                              },
                              "Section regenerated."
                            )
                          }
                          className="font-medium text-zinc-500 transition-colors hover:text-zinc-900 disabled:opacity-40"
                        >
                          {busy === `regen-${section.id}` ? "Regenerating…" : "Regenerate"}
                        </button>
                        {pastVersions.length > 0 && (
                          <>
                            <span className="text-zinc-300">·</span>
                            <button
                              onClick={() => setOpenHistory((h) => ({ ...h, [section.id]: !historyOpen }))}
                              className="font-medium text-zinc-500 transition-colors hover:text-zinc-900"
                            >
                              {historyOpen ? "Hide history" : `History (${pastVersions.length})`}
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {canEdit && historyOpen && pastVersions.length > 0 && (
                      <ul className="mt-3 flex flex-col gap-2 rounded-md border border-zinc-100 bg-zinc-50 p-3">
                        {pastVersions.map((v) => (
                          <li key={v.id} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-zinc-700">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${v.generatedBy === "human" ? "bg-violet-500" : "bg-purple-500"}`}
                                />
                                {v.generatedBy === "human" ? "Human edit" : "AI regeneration"}
                                <span className="font-normal text-zinc-400">
                                  · {new Date(v.createdAt).toLocaleString()}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{v.content || "(empty)"}</p>
                            </div>
                            <button
                              disabled={busy !== null}
                              onClick={() =>
                                run(
                                  `restore-${v.id}`,
                                  async () => {
                                    const data = await call(
                                      `/api/proposals/${proposal.id}/sections/${section.id}/restore`,
                                      { method: "POST", body: JSON.stringify({ versionId: v.id }) }
                                    );
                                    setDrafts((d) => ({ ...d, [section.id]: data.content }));
                                  },
                                  "Section restored."
                                )
                              }
                              className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40"
                            >
                              {busy === `restore-${v.id}` ? "Restoring…" : "Restore"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="mb-2.5 text-sm font-medium text-zinc-900">Supporting material</h2>
            <ul className="mb-3 text-sm text-zinc-600">
              {proposal.attachments.map((a) => (
                <li key={a.id}>
                  {a.filename}{" "}
                  {a.extractedText ? "" : <span className="text-zinc-400">(no text extracted — unsupported file type)</span>}
                </li>
              ))}
              {proposal.attachments.length === 0 && <li className="text-zinc-400">None uploaded.</li>}
            </ul>
            {canEdit && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={(e) => setHasFileSelected(!!e.target.files && e.target.files.length > 0)}
                    className="text-sm text-zinc-600"
                  />
                  <button
                    disabled={busy !== null || !hasFileSelected}
                    onClick={() =>
                      run(
                        "upload",
                        async () => {
                          const files = fileInputRef.current?.files;
                          if (!files || files.length === 0) throw new Error("Choose a file first.");
                          const form = new FormData();
                          Array.from(files).forEach((f) => form.append("files", f));
                          const res = await fetch(`/api/proposals/${proposal.id}/attachments`, {
                            method: "POST",
                            body: form,
                          });
                          if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
                          if (fileInputRef.current) fileInputRef.current.value = "";
                          setHasFileSelected(false);
                        },
                        "File(s) uploaded."
                      )
                    }
                    className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                  >
                    {busy === "upload" ? "Uploading…" : "Upload"}
                  </button>
                </div>
                <p className="text-xs text-zinc-400">Extracted for AI context: {SUPPORTED_EXTRACTION_LABEL}.</p>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-900">Document</h2>
              <button
                disabled={!sectionsComplete || busy !== null}
                onClick={() =>
                  run("document", () => call(`/api/proposals/${proposal.id}/documents`, { method: "POST" }), "PDF generated.")
                }
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                title={!sectionsComplete ? "All sections must be filled in (and not flagged needs input) first" : undefined}
              >
                {busy === "document" ? "Generating PDF…" : "Generate PDF"}
              </button>
            </div>
            {!latestDocument ? (
              <p className="text-sm text-zinc-400">
                No document generated yet. Once every section is complete, generate one to preview it here.
              </p>
            ) : (
              <>
                <div className="overflow-hidden rounded-md border border-zinc-200">
                  <iframe
                    src={`/api/documents/${latestDocument.id}/download`}
                    className="h-[500px] w-full"
                    title="Latest proposal document preview"
                  />
                </div>
                <a
                  href={`/api/documents/${latestDocument.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-sm text-teal-700 underline hover:text-teal-800"
                >
                  Open latest PDF in a new tab ↗
                </a>
                {earlierDocuments.length > 0 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-zinc-600 hover:text-zinc-900">
                      {earlierDocuments.length} earlier version{earlierDocuments.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1 pl-1">
                      {earlierDocuments.map((d) => (
                        <li key={d.id}>
                          <a
                            href={`/api/documents/${d.id}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-600 underline hover:text-teal-700"
                          >
                            {d.kind.toUpperCase()} — {new Date(d.createdAt).toLocaleString()}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {canSend && (
              <button
                disabled={busy !== null}
                onClick={() => setShowSendConfirm(true)}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                {proposal.status === "send_failed" || proposal.status === "document_failed"
                  ? "Retry send to client"
                  : "Send to client"}
              </button>
            )}
            {canUndoApproval && (
              <button
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "undo-approval",
                    () => call(`/api/proposals/${proposal.id}/undo-approval`, { method: "POST" }),
                    "Approval undone — back to pending review."
                  )
                }
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                {busy === "undo-approval" ? "Undoing…" : "Undo approval"}
              </button>
            )}
            {canSubmit && (
              <button
                disabled={busy !== null || !sectionsComplete}
                onClick={() =>
                  run(
                    "submit",
                    () => call(`/api/proposals/${proposal.id}/submit`, { method: "POST" }),
                    "Submitted for approval."
                  )
                }
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                title={!sectionsComplete ? "All sections must be filled in (and not flagged needs input) first" : undefined}
              >
                {busy === "submit" ? "Submitting…" : "Submit for approval"}
              </button>
            )}
            {canDecide && !showChangesForm && (
              <>
                <button
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      "approve",
                      () =>
                        call(`/api/proposals/${proposal.id}/decision`, {
                          method: "POST",
                          body: JSON.stringify({ decision: "approved" }),
                        }),
                      "Proposal approved."
                    )
                  }
                  className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:opacity-50"
                >
                  {busy === "approve" ? "Approving…" : "Approve"}
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() => setShowChangesForm(true)}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                >
                  Request changes
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      "reject",
                      () =>
                        call(`/api/proposals/${proposal.id}/decision`, {
                          method: "POST",
                          body: JSON.stringify({ decision: "rejected" }),
                        }),
                      "Proposal rejected."
                    )
                  }
                  className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  {busy === "reject" ? "Rejecting…" : "Reject"}
                </button>
              </>
            )}
            {canDecide && showChangesForm && (
              <div className="flex w-full flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <label htmlFor="changes-comment" className="text-sm font-medium text-zinc-700">
                  What needs to change?
                </label>
                <textarea
                  id="changes-comment"
                  rows={3}
                  autoFocus
                  value={changesComment}
                  onChange={(e) => setChangesComment(e.target.value)}
                  placeholder="Be specific — this goes straight back to the salesperson."
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
                />
                <div className="flex gap-2">
                  <button
                    disabled={busy !== null || !changesComment.trim()}
                    onClick={() =>
                      run(
                        "changes",
                        async () => {
                          await call(`/api/proposals/${proposal.id}/decision`, {
                            method: "POST",
                            body: JSON.stringify({ decision: "changes_requested", comment: changesComment.trim() }),
                          });
                          setShowChangesForm(false);
                          setChangesComment("");
                        },
                        "Sent back to the salesperson for changes."
                      )
                    }
                    className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {busy === "changes" ? "Sending…" : "Send"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      setShowChangesForm(false);
                      setChangesComment("");
                    }}
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSendConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4"
          onClick={() => busy === null && setShowSendConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-confirm-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-xl"
          >
            <h2 id="send-confirm-title" className="text-base font-semibold text-zinc-900">
              Send this proposal to the client?
            </h2>
            <p className="mt-1.5 text-sm text-zinc-500">
              This emails the proposal document directly — double-check who it&rsquo;s going to.
            </p>

            <dl className="mt-4 flex flex-col gap-2.5 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-zinc-500">Recipient</dt>
                <dd className="truncate text-right font-medium text-zinc-900">{proposal.clientEmail}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-zinc-500">Client</dt>
                <dd className="truncate text-right font-medium text-zinc-900">{proposal.clientName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-zinc-500">Company</dt>
                <dd className="truncate text-right font-medium text-zinc-900">{proposal.companyName}</dd>
              </div>
              {sendCcEmails.length > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-zinc-500">Cc</dt>
                  <dd className="text-right font-medium text-zinc-900">
                    {sendCcEmails.join(", ")}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setShowSendConfirm(false)}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={confirmSend}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy === "send" ? "Sending…" : "Yes, send it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
