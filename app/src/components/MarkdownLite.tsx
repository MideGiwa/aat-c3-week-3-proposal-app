import { Fragment } from "react";
import { parseMarkdownLite } from "@/lib/markdown-lite";

// Renders the same small markdown subset the generation prompt asks Claude
// for (headings, paragraphs, "- "/"1. " lists, "---" rules, **bold**) — the
// HTML-side counterpart to renderMarkdownish in src/lib/pdf.ts. Both now
// share one parser (markdown-lite.ts) instead of two hand-rolled copies,
// which is what let this component grow [NEEDS INPUT: ...] highlighting
// and heading support at different times than the PDF renderer did.
//
// No HTML is ever parsed from `content` — everything here becomes React
// text children or element props, never dangerouslySetInnerHTML, so this is
// safe even though section content can come from a human edit as well as
// Claude.

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\[NEEDS INPUT:[^\]]*\])/g;

function renderInline(text: string, keyPrefix: string) {
  return text
    .split(INLINE_PATTERN)
    .filter((part) => part.length > 0)
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`;
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("[NEEDS INPUT")) {
        return (
          <mark key={key} className="rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-800">
            {part}
          </mark>
        );
      }
      return <Fragment key={key}>{part}</Fragment>;
    });
}

// Heading levels 1-2 read as a subsection within the section (which already
// has its own, larger title rendered by the caller); 3+ collapse to the
// same small bold treatment rather than introducing a third size nobody
// asked for.
const HEADING_CLASS: Record<number, string> = {
  1: "text-sm font-semibold text-zinc-900",
  2: "text-sm font-semibold text-zinc-900",
};

export function MarkdownLite({ content }: { content: string }) {
  const blocks = parseMarkdownLite(content);

  if (blocks.length === 0) {
    return <p className="text-sm italic text-zinc-400">Not generated yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-zinc-800">
      {blocks.map((block, bi) => {
        switch (block.type) {
          case "heading":
            return (
              <p key={bi} className={HEADING_CLASS[block.level] ?? "text-sm font-semibold text-zinc-800"}>
                {renderInline(block.text, `${bi}`)}
              </p>
            );
          case "hr":
            return <hr key={bi} className="border-zinc-200" />;
          case "list": {
            const items = block.items.map((item, li) => (
              <li key={li}>{renderInline(item, `${bi}-${li}`)}</li>
            ));
            return block.ordered ? (
              <ol key={bi} className="list-decimal space-y-1 pl-5">
                {items}
              </ol>
            ) : (
              <ul key={bi} className="list-disc space-y-1 pl-5">
                {items}
              </ul>
            );
          }
          case "paragraph":
          default:
            return <p key={bi}>{renderInline(block.text, `${bi}`)}</p>;
        }
      })}
    </div>
  );
}
