// Shown immediately while the proposal detail page is rendered on the
// server. `proposals/[id]/page.tsx` is `force-dynamic` (it reads the
// session and always hits the database fresh) and Next.js skips
// prefetching dynamic routes, so without this file a click on a proposal
// row has nothing to show until the server responds — on a slow request it
// can look like the click did nothing at all. This file lets Next.js
// navigate immediately and stream the real content in once it's ready.
function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-zinc-100 ${className}`} />;
}

export default function ProposalDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 border-b border-zinc-200 pb-5">
        <SkeletonBlock className="h-6 w-64" />
        <SkeletonBlock className="mt-2 h-4 w-40" />
        <SkeletonBlock className="mt-4 h-6 w-72" />
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <aside className="order-2 w-full shrink-0 lg:order-1 lg:w-64">
          <SkeletonBlock className="mb-3 h-4 w-20" />
          <div className="flex flex-col gap-4 border-l border-zinc-200 pl-4">
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        </aside>

        <div className="order-1 min-w-0 flex-1 lg:order-2">
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="divide-y divide-zinc-100">
              {[0, 1, 2].map((i) => (
                <div key={i} className="p-6 sm:p-8">
                  <SkeletonBlock className="mb-3 h-4 w-40" />
                  <SkeletonBlock className="h-3 w-full" />
                  <SkeletonBlock className="mt-2 h-3 w-5/6" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
