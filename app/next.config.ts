import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (src/lib/attachment-extraction.ts) wraps pdfjs-dist, which
  // resolves its worker script (pdf.worker.mjs) via a dynamic import
  // relative to its own package location at runtime. Bundling it (the
  // default for anything imported from an API route) rewrites that
  // relative path and breaks the lookup — the worker chunk just isn't
  // where pdfjs-dist expects it inside .next's output. Marking it (and
  // its own dependency) external makes Next load it via plain `require`
  // from node_modules instead, so the path pdfjs-dist computes for itself
  // stays correct.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
