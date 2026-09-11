// A lightweight horizontal progress indicator for the proposal's real
// lifecycle (architecture.md's status state machine), shown alongside the
// colored status badge on the detail page. The badge says exactly what's
// happening right now; this shows how far along the proposal is and makes
// the milestones ahead visible, especially useful for an approver landing
// on a proposal for the first time.
const STEPS = ["Draft", "Review", "Approved", "Sent"];

type Tone = "current" | "warn" | "error";

function stepState(status: string): { index: number; tone: Tone } {
  switch (status) {
    case "generation_failed":
      return { index: 0, tone: "error" };
    case "changes_requested":
      return { index: 0, tone: "warn" };
    case "pending_review":
      return { index: 1, tone: "current" };
    case "approved":
      return { index: 2, tone: "current" };
    case "document_failed":
    case "send_failed":
      // Both only ever occur once a proposal has already been approved
      // (see the documents route's status-transition guard), so "Approved"
      // is still the right milestone to flag — the exception is in trying
      // to get past it, not in the approval itself.
      return { index: 2, tone: "error" };
    case "sent":
      return { index: 3, tone: "current" };
    case "draft":
    default:
      return { index: 0, tone: "current" };
  }
}

export function StatusStepper({ status }: { status: string }) {
  const { index: currentIndex, tone } = stepState(status);

  return (
    <ol className="flex items-center">
      {STEPS.map((label, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        const isLast = i === STEPS.length - 1;

        let circleClasses = "border-zinc-200 bg-white text-zinc-400";
        if (isDone) {
          circleClasses = "border-zinc-900 bg-zinc-900 text-white";
        } else if (isCurrent) {
          if (tone === "error") circleClasses = "border-red-500 bg-red-500 text-white";
          else if (tone === "warn") circleClasses = "border-amber-500 bg-amber-500 text-white";
          else circleClasses = "border-zinc-900 bg-white text-zinc-900";
        }

        return (
          <li key={label} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${circleClasses}`}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <span
                className={`hidden text-xs font-medium sm:inline ${
                  isDone || isCurrent ? "text-zinc-700" : "text-zinc-400"
                }`}
              >
                {label}
              </span>
            </div>
            {!isLast && <span aria-hidden="true" className="mx-2 h-px w-4 bg-zinc-200 sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}
