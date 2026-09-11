import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// Local-disk storage for generated documents. This is a deliberate,
// documented simplification for this stage of the build (see README):
// it works fine for `next dev` / a single long-running server, but an
// ephemeral/serverless deploy (Vercel functions, most containers) will
// lose these files between invocations or restarts. Swap this module for
// an S3/R2/Supabase-Storage-backed version before deploying anywhere but a
// single persistent server — nothing outside this file needs to change,
// since callers only see `storagePath` as an opaque string.

const STORAGE_ROOT =
  process.env.DOCUMENT_STORAGE_DIR || path.join(process.cwd(), "storage", "documents");

export async function saveDocumentFile(
  proposalId: string,
  documentId: string,
  buffer: Buffer,
  extension: string
): Promise<string> {
  // turbopackIgnore: this is local-disk storage, already flagged in the
  // comment above as unsuitable for a traced/serverless deploy — the build
  // warning this would otherwise produce says the same thing.
  const dir = path.join(/* turbopackIgnore: true */ STORAGE_ROOT, proposalId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${documentId}.${extension}`);
  await writeFile(filePath, buffer);
  return filePath;
}

export async function readDocumentFile(storagePath: string): Promise<Buffer> {
  return readFile(storagePath);
}
