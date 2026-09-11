import Anthropic from "@anthropic-ai/sdk";
import { SECTION_DEFS, SectionKey } from "./proposal-fields";

// Thin wrapper around the Anthropic API (architecture.md section 3.3).
// Prompt construction, forced structured output, and error classification
// all live here so nothing else in the app talks to the SDK directly.

let _client: Anthropic | null = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new GenerationError(
      "config",
      "ANTHROPIC_API_KEY is not set. Add it to .env.local."
    );
  }
  _client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export const CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

export type GeneratedSections = Record<SectionKey, string>;

export type GenerationErrorKind =
  | "config"
  | "rate_limit"
  | "timeout"
  | "malformed_response"
  | "api_error";

export class GenerationError extends Error {
  constructor(
    public kind: GenerationErrorKind,
    message: string
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

const SYSTEM_PROMPT = `You are a proposal writer for a sales team. You turn structured discovery-call notes into a clear, professional, client-ready proposal.

Follow this structure, writing one entry per section: Introduction, Proposed Solution (weave in the project scope and your recommended approach), Deliverables, Timeline, Pricing, Next Steps.

Ground every claim in the intake details and any supporting material you are given. Do not invent client names, prices, timelines, or deliverables that were not provided or clearly implied by the material. If a section depends on information that is missing, contradictory, or too vague to write responsibly, do not guess — write "[NEEDS INPUT: <specific missing detail>]" as that section's content instead.

If supporting material is provided, reference something concrete from it (a named detail, figure, or requirement) rather than writing generically.

Write in a warm, confident, professional tone suitable for sending directly to a client.

Formatting: each section's content is inserted under a heading the document already renders for you (e.g. "3. Deliverables") — do not repeat that section's name as a heading inside your answer, and do not start a section with a "#"-style heading at all. Only use "##"/"###" for a genuine sub-heading within a long section (e.g. breaking Deliverables into named workstreams), and keep it rare. You may use "- " bullet lists, "1. " numbered lists, and **bold** for emphasis; avoid tables, links, and other markdown the reader won't see rendered.`;

function sectionToolSchema(keys: readonly SectionKey[]) {
  const titleByKey = Object.fromEntries(
    SECTION_DEFS.map((s) => [s.key, s.title])
  );
  return {
    name: "return_proposal_sections",
    description:
      "Return the drafted proposal content, broken into the given fixed set of named sections.",
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        keys.map((key) => [
          key,
          {
            type: "string",
            description: `Markdown content for the "${titleByKey[key]}" section.`,
          },
        ])
      ),
      required: [...keys],
    },
  };
}

function formatIntake(intake: Record<string, string | undefined>): string {
  return Object.entries(intake)
    .map(([k, v]) => `${k}: ${v?.trim() ? v : "(not provided)"}`)
    .join("\n");
}

function formatSupportingMaterial(
  files: { filename: string; extractedText: string }[]
): string {
  if (files.length === 0) return "";
  return (
    "\n\nSupporting material provided by the salesperson (reference it concretely where relevant):\n" +
    files
      .map((f) => `--- ${f.filename} ---\n${f.extractedText}`)
      .join("\n\n")
  );
}

function classifyError(err: unknown): GenerationError {
  if (err instanceof GenerationError) return err;
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return new GenerationError("rate_limit", err.message);
    if (err.status === 408 || err.status === 504)
      return new GenerationError("timeout", err.message);
    return new GenerationError("api_error", `${err.status}: ${err.message}`);
  }
  if (err instanceof Error) return new GenerationError("api_error", err.message);
  return new GenerationError("api_error", "Unknown error generating the proposal");
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const classified = classifyError(err);
    if (classified.kind === "rate_limit" || classified.kind === "timeout") {
      // one retry after a short delay, per architecture.md section 3.3
      await new Promise((r) => setTimeout(r, 1500));
      try {
        return await fn();
      } catch (err2) {
        throw classifyError(err2);
      }
    }
    throw classified;
  }
}

export async function generateProposalSections(params: {
  intake: Record<string, string | undefined>;
  supportingMaterial?: { filename: string; extractedText: string }[];
}): Promise<GeneratedSections> {
  const keys = SECTION_DEFS.map((s) => s.key);

  return withRetry(async () => {
    const message = await client().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [sectionToolSchema(keys)],
      tool_choice: { type: "tool", name: "return_proposal_sections" },
      messages: [
        {
          role: "user",
          content:
            `Intake details from the discovery call:\n${formatIntake(params.intake)}` +
            formatSupportingMaterial(params.supportingMaterial ?? []),
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new GenerationError(
        "malformed_response",
        "The AI service did not return structured section output"
      );
    }
    return toolUse.input as GeneratedSections;
  });
}

export async function regenerateProposalSection(params: {
  sectionKey: SectionKey;
  intake: Record<string, string | undefined>;
  otherSections: Partial<GeneratedSections>;
  supportingMaterial?: { filename: string; extractedText: string }[];
  reviewerNote?: string;
}): Promise<string> {
  const title = SECTION_DEFS.find((s) => s.key === params.sectionKey)!.title;
  const contextBlock = Object.entries(params.otherSections)
    .map(([key, content]) => `--- ${key} (already finalized, keep consistent with this) ---\n${content}`)
    .join("\n\n");

  return withRetry(async () => {
    const message = await client().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [sectionToolSchema([params.sectionKey])],
      tool_choice: { type: "tool", name: "return_proposal_sections" },
      messages: [
        {
          role: "user",
          content:
            `Intake details from the discovery call:\n${formatIntake(params.intake)}` +
            formatSupportingMaterial(params.supportingMaterial ?? []) +
            `\n\nThe rest of the proposal has already been written and approved so far — keep tone and facts consistent with it:\n${contextBlock}` +
            `\n\nRewrite only the "${title}" section.` +
            (params.reviewerNote
              ? ` Incorporate this note from the reviewer: ${params.reviewerNote}`
              : ""),
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new GenerationError(
        "malformed_response",
        "The AI service did not return structured section output"
      );
    }
    const input = toolUse.input as GeneratedSections;
    return input[params.sectionKey];
  });
}
