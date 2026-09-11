import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

// Extracts plain text from an uploaded piece of supporting material so the
// AI Generation Service actually has something to reference — architecture.md
// 3.3: "extract text from uploaded attachments and include it as generation
// context". Originally this covered only .txt/.md/.csv (a documented,
// intentional gap for PDF/DOCX); this fills that gap since supporting
// material in practice is usually a PDF brief or a DOCX scope document, not
// a plain-text file, and content that isn't extracted here is silently
// never used as generation context.
const PLAIN_TEXT_EXTENSIONS = [".txt", ".md", ".csv"];

export const SUPPORTED_EXTRACTION_LABEL = ".txt, .md, .csv, .pdf, .docx";

function endsWithAny(filename: string, exts: string[]): boolean {
  const lower = filename.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

export async function extractAttachmentText(file: File): Promise<string | null> {
  const filename = file.name;

  try {
    if (endsWithAny(filename, PLAIN_TEXT_EXTENSIONS)) {
      const text = await file.text();
      return text.trim() || null;
    }

    if (filename.toLowerCase().endsWith(".pdf")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result.text.trim() || null;
      } finally {
        await parser.destroy();
      }
    }

    if (filename.toLowerCase().endsWith(".docx")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { value } = await mammoth.extractRawText({ buffer });
      return value.trim() || null;
    }

    // Legacy .doc, images, spreadsheets, etc. — no extractor available yet.
    // The file is still stored and visible in the UI, just without
    // extracted text (shown as "no text extracted yet"), the same
    // documented gap as before, just narrower.
    return null;
  } catch (err) {
    // A corrupt, password-protected, or unexpectedly-encoded file
    // shouldn't fail the whole upload — store it with no extracted text
    // rather than rejecting it outright.
    console.error(`Attachment text extraction failed for ${filename}:`, err);
    return null;
  }
}
