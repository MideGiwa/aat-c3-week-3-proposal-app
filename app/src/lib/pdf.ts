import PDFDocument from "pdfkit";
import { parseMarkdownLite } from "./markdown-lite";

// Renders the final client-facing document (architecture.md 3.6). Uses
// pdfkit — pure JS/TS, no native binary, no headless-browser dependency —
// deliberately instead of printing HTML through a headless Chromium: that
// approach needs a real browser binary shipped with the deploy (a real
// headache on serverless hosts, and the binary download was itself blocked
// in the sandbox this was built in). pdfkit trades some visual fidelity
// with the HTML preview for something that just works everywhere the app
// runs, including a plain `next build` on Vercel with no extra config.

export type PdfSection = { title: string; content: string };

export type ProposalPdfInput = {
  clientName: string;
  companyName: string;
  salespersonName: string;
  dateOfCall: string | null;
  sections: PdfSection[];
};

const FONT_REGULAR = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";

export async function renderProposalPdf(data: ProposalPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 56, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // pdfkit's standard (AFM) fonts carry built-in typographic kerning
    // pairs, and Helvetica-Bold's table includes `space T -100` — enough to
    // make any bold text starting with a capital T right after a space
    // render as if the space were missing ("4.Timeline" instead of
    // "4. Timeline"). That hits real proposal content: "Timeline",
    // "Technical Approach", "Terms", "Total Investment", "Testimonials" are
    // all plausible section or sub-heading titles. Grabbing each font right
    // after selecting it and clearing its kern-pair table disables kerning
    // for that (cached, reused) font instance for the rest of the document —
    // even, untuned letter-spacing beats "correct" kerning here, since every
    // width this file computes by hand (the list hanging-indent in
    // particular) assumes plain glyph advances with no kerning adjustment.
    for (const name of [FONT_REGULAR, FONT_BOLD]) {
      doc.font(name);
      // pdfkit wraps the standard 14 fonts in a `StandardFont`, which holds
      // the actual AFM font (kern table included) one level down at
      // `._font.font`, not on `._font` itself.
      const afmFont = (doc as unknown as { _font: { font?: { kernPairs?: Record<string, number> } } })
        ._font.font;
      if (afmFont?.kernPairs) afmFont.kernPairs = {};
    }

    doc.font(FONT_BOLD).fontSize(20).fillColor("#111111").text(`Proposal for ${data.clientName}`);
    doc.moveDown(0.3);
    doc.font(FONT_REGULAR).fontSize(11).fillColor("#555555");
    doc.text(`Prepared by ${data.salespersonName}`);
    doc.text(`Date: ${data.dateOfCall || new Date().toLocaleDateString()}`);
    doc.fillColor("#111111");
    doc.moveDown(1.2);

    for (const section of data.sections) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();
      doc.font(FONT_BOLD).fontSize(14).text(section.title);
      doc.moveDown(0.4);
      doc.font(FONT_REGULAR).fontSize(11);
      renderMarkdownish(doc, section.content);
      doc.moveDown(1);
    }

    doc.moveDown(0.5);
    doc.font(FONT_REGULAR).fontSize(11);
    doc.text("Warm regards,");
    doc.text(data.salespersonName);
    doc.text("Koya Talent");

    doc.end();
  });
}

// Renders the shared small-markdown-subset AST from markdown-lite.ts —
// headings, horizontal rules, bullet/numbered lists (with a proper hanging
// indent so a wrapped item's second line lines up under the text rather
// than under the page margin), paragraphs, **bold** inline spans, and
// [NEEDS INPUT: ...] markers called out in color so a placeholder that
// somehow made it this far is impossible to miss on the page rather than
// blending into a normal paragraph.
function renderMarkdownish(doc: PDFKit.PDFDocument, content: string) {
  const blocks = parseMarkdownLite(content);

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        // Section titles are already rendered separately at 14pt bold by
        // the caller, so an in-content heading (Claude restating or adding
        // a sub-heading) is sized to read as a level below that rather than
        // competing with it, however deep the `#` nesting actually is.
        const size = block.level <= 2 ? 12.5 : 11;
        doc.moveDown(0.3);
        doc.fontSize(size);
        renderInline(doc, block.text, { bold: true });
        doc.fontSize(11);
        doc.moveDown(0.3);
        break;
      }
      case "hr": {
        doc.moveDown(0.3);
        const y = doc.y;
        doc.save().strokeColor("#dddddd").lineWidth(1)
          .moveTo(doc.page.margins.left, y)
          .lineTo(doc.page.width - doc.page.margins.right, y)
          .stroke()
          .restore();
        doc.moveDown(0.5);
        break;
      }
      case "list": {
        renderList(doc, block.items, block.ordered);
        doc.moveDown(0.6);
        break;
      }
      case "paragraph": {
        renderInline(doc, block.text);
        doc.moveDown(0.6);
        break;
      }
    }
  }
}

// A hanging indent for list items: the marker ("•" or "1.") is printed at
// the left margin with a fixed-width box, then the item text is given an
// explicit x/y/width so wrapped lines stay indented under the text rather
// than falling back to the page margin. pdfkit only honors an explicit
// `width` on the call that *opens* a run of `continued` text — a plain
// `{ continued: true }` with no x/y/width (the previous approach) inherits
// the page's own margins for wrapping, not any indent set up beforehand, so
// the width has to be passed into renderInline's first segment directly
// rather than nudged in via `doc.page.margins`.
function renderList(doc: PDFKit.PDFDocument, items: string[], ordered: boolean) {
  const baseLeft = doc.page.margins.left;
  const indent = ordered ? 20 : 14;
  const contentWidth = doc.page.width - doc.page.margins.right - (baseLeft + indent);

  items.forEach((item, i) => {
    const marker = ordered ? `${i + 1}.` : "•";
    const y = doc.y;
    doc.font(FONT_REGULAR).fillColor("#111111")
      .text(marker, baseLeft, y, { continued: false, lineBreak: false, width: indent });
    renderInline(doc, item, { startAt: { x: baseLeft + indent, y, width: contentWidth } });
    doc.moveDown(0.25);
  });
}

// Renders **bold** spans and [NEEDS INPUT: ...] markers inline. `bold`
// forces the whole run bold regardless of ** markup (used for headings).
// `startAt` gives the first segment an explicit position and wrap width —
// needed for hanging-indent list items; paragraphs/headings omit it and
// just flow from the current cursor at the page's normal width.
function renderInline(
  doc: PDFKit.PDFDocument,
  text: string,
  opts: { bold?: boolean; startAt?: { x: number; y: number; width: number } } = {}
) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[NEEDS INPUT:[^\]]*\])/g).filter((p) => p.length > 0);
  if (parts.length === 0) {
    if (opts.startAt) doc.text("", opts.startAt.x, opts.startAt.y);
    return;
  }
  parts.forEach((part, i) => {
    const isBold = opts.bold || (part.startsWith("**") && part.endsWith("**"));
    const isNeedsInput = part.startsWith("[NEEDS INPUT");
    const clean = part.startsWith("**") && part.endsWith("**") ? part.slice(2, -2) : part;
    const continued = i < parts.length - 1;
    doc.font(isBold || isNeedsInput ? FONT_BOLD : FONT_REGULAR).fillColor(isNeedsInput ? "#b45309" : "#111111");
    if (i === 0 && opts.startAt) {
      doc.text(clean, opts.startAt.x, opts.startAt.y, { continued, width: opts.startAt.width });
    } else {
      doc.text(clean, { continued });
    }
  });
  doc.font(FONT_REGULAR).fillColor("#111111");
}
