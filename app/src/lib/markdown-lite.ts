// The single source of truth for the small markdown subset this app
// supports in generated section content — shared by the two renderers that
// used to each implement (and drift from) their own copy: `renderMarkdownish`
// in pdf.ts (PDFKit output) and `MarkdownLite` (the React/HTML preview).
//
// Splitting parsing from rendering is what let the PDF renderer silently
// fall behind the HTML one: MarkdownLite grew "[NEEDS INPUT: ...]"
// highlighting that renderMarkdownish never got, and neither of them ever
// handled `#` headings at all — a heading line just fell through to the
// plain-paragraph case and printed its literal `#` characters. Both bugs
// came from the same place (two hand-rolled, subtly different parsers), so
// the fix is one parser both renderers consume.
//
// Supported constructs, matching what the generation prompt in anthropic.ts
// actually asks Claude for: headings (`#` through `######`), "- "/"* "
// bullet lists, "1. "/"1) " numbered lists, "---" horizontal rules, and
// **bold** inline spans. Anything else (tables, links, images, nested
// blockquotes, etc.) is deliberately not special-cased — it renders as
// plain text rather than crashing, but won't look "formatted".

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;
const HR_RE = /^(-{3,}|_{3,}|\*{3,})$/;
const BULLET_RE = /^[-*]\s+(.*)$/;
const NUMBERED_RE = /^\d+[.)]\s+(.*)$/;

export function parseMarkdownLite(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  let pending: string[] = [];
  let pendingKind: "bullet" | "numbered" | "text" | null = null;

  function flushPending() {
    if (pending.length === 0) return;
    if (pendingKind === "bullet" || pendingKind === "numbered") {
      blocks.push({ type: "list", ordered: pendingKind === "numbered", items: pending.slice() });
    } else {
      blocks.push({ type: "paragraph", text: pending.join(" ") });
    }
    pending = [];
    pendingKind = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "") {
      flushPending();
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushPending();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    if (HR_RE.test(line)) {
      flushPending();
      blocks.push({ type: "hr" });
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      if (pendingKind !== "bullet") flushPending();
      pendingKind = "bullet";
      pending.push(bullet[1]);
      continue;
    }

    const numbered = line.match(NUMBERED_RE);
    if (numbered) {
      if (pendingKind !== "numbered") flushPending();
      pendingKind = "numbered";
      pending.push(numbered[1]);
      continue;
    }

    // Plain text line: joins the current paragraph, unless it's continuing
    // a list (Claude sometimes wraps a long list item onto a soft-wrapped
    // second line without a marker) — in that case fold it onto the last
    // item instead of starting a stray one-line paragraph in the middle of
    // a list.
    if (pendingKind === "bullet" || pendingKind === "numbered") {
      if (pending.length > 0) pending[pending.length - 1] += ` ${line}`;
      else pending.push(line);
      continue;
    }
    pendingKind = "text";
    pending.push(line);
  }
  flushPending();

  return blocks;
}
