import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { proposals } from "@/lib/db/schema";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { STATUS_LABEL, STATUS_DOT } from "@/lib/proposal-fields";

export const dynamic = "force-dynamic";

const FAILED_STATUSES = ["generation_failed", "document_failed", "send_failed"];

// Tabs are a small, fixed set rather than one per literal status value —
// grouping the three *_failed statuses under one "Needs attention" tab
// matches how someone actually scans this list (looking for "what's stuck"),
// not how the state machine happens to be modeled in the database.
const FILTERS: { key: string; label: string; match: (status: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "draft", label: "Draft", match: (s) => s === "draft" },
  { key: "pending_review", label: "Pending review", match: (s) => s === "pending_review" },
  { key: "approved", label: "Approved", match: (s) => s === "approved" },
  { key: "changes_requested", label: "Changes requested", match: (s) => s === "changes_requested" },
  { key: "sent", label: "Sent", match: (s) => s === "sent" },
  { key: "needs_attention", label: "Needs attention", match: (s) => FAILED_STATUSES.includes(s) },
];

// The "central place" the PRD asks for: every proposal, its status, and
// (for failed proposals) the reason, in one list.
export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { status: statusParam, q: qParam } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === statusParam) ?? FILTERS[0];
  const query = (qParam ?? "").trim();

  const allRows = await db.query.proposals.findMany({
    orderBy: [desc(proposals.createdAt)],
    with: { salesperson: true },
  });

  const pendingCount = allRows.filter((p) => p.status === "pending_review").length;
  const needsAttentionCount = allRows.filter(
    (p) => FAILED_STATUSES.includes(p.status) || p.status === "changes_requested"
  ).length;

  const lowerQuery = query.toLowerCase();
  const rows = allRows.filter((p) => {
    if (!activeFilter.match(p.status)) return false;
    if (!lowerQuery) return true;
    return (
      p.clientName.toLowerCase().includes(lowerQuery) ||
      p.companyName.toLowerCase().includes(lowerQuery)
    );
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between border-b border-zinc-200 pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Proposals</h1>
          {allRows.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-baseline gap-1.5">
                <span className="font-semibold text-zinc-900">{allRows.length}</span>
                <span className="text-zinc-500">total</span>
              </div>
              {pendingCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span className="font-medium text-zinc-900">{pendingCount}</span>
                  <span className="text-zinc-500">pending review</span>
                </div>
              )}
              {needsAttentionCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="font-medium text-zinc-900">{needsAttentionCount}</span>
                  <span className="text-zinc-500">needs attention</span>
                </div>
              )}
            </div>
          )}
        </div>
        <Link
          href="/proposals/new"
          className="shrink-0 rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
        >
          New proposal
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const isActive = f.key === activeFilter.key;
            const href = f.key === "all" ? "/proposals" : `/proposals?status=${f.key}`;
            return (
              <Link
                key={f.key}
                href={query ? `${href}${href.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}` : href}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
        <form method="GET" className="flex gap-2">
          {activeFilter.key !== "all" && <input type="hidden" name="status" value={activeFilter.key} />}
          <div className="relative w-full sm:w-56">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search client or company…"
              className="w-full rounded-md border border-zinc-300 py-1.5 pl-8 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400"
            />
          </div>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Search
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-zinc-200 text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-4 py-2.5">Client</th>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Salesperson</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="group relative cursor-pointer border-t border-zinc-100 hover:bg-zinc-50">
                <td className="px-4 py-3">
                  {/* The row itself is the click target (a plain `<tr onClick>`
                      would need this to be a client component, so instead this
                      link is stretched with `absolute inset-0` to cover the
                      whole row via the `relative` tr above — a single
                      accessible link, not just the client-name text). */}
                  <Link
                    href={`/proposals/${p.id}`}
                    className="absolute inset-0"
                    aria-label={`View proposal for ${p.clientName} — ${p.companyName}`}
                  />
                  <span className="relative font-medium text-zinc-900 group-hover:text-teal-700 group-hover:underline">
                    {p.clientName}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-600">{p.companyName}</td>
                <td className="px-4 py-3 text-zinc-600">{p.salesperson.name}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[p.status] ?? "bg-zinc-400"}`} />
                    <span className="text-zinc-700">{STATUS_LABEL[p.status] ?? p.status.replace(/_/g, " ")}</span>
                  </span>
                  {p.lastError && (
                    <div className="mt-1 max-w-xs truncate text-xs text-red-600" title={p.lastError}>
                      {p.lastError}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-zinc-500">
                  {new Date(p.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {rows.length === 0 && allRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-14 text-center">
                  <p className="text-sm font-medium text-zinc-600">No proposals yet.</p>
                  <p className="mt-1 text-sm text-zinc-400">Create your first one to get started.</p>
                  <Link
                    href="/proposals/new"
                    className="mt-3 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                  >
                    New proposal
                  </Link>
                </td>
              </tr>
            )}
            {rows.length === 0 && allRows.length > 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-14 text-center">
                  <p className="text-sm font-medium text-zinc-600">No proposals match this view.</p>
                  <p className="mt-1 text-sm text-zinc-400">Try a different filter or clear the search.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
