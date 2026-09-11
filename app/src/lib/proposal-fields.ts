// Reference structures mirrored from the project docs:
// - intake-form-fields.md -> INTAKE_FIELDS
// - proposal-template.md  -> SECTION_DEFS
//
// `salesperson_name` from intake-form-fields.md is deliberately not an
// intake field here — it's filled in automatically from the signed-in user,
// since asking a salesperson to type their own name is redundant once
// there's a login.

export const INTAKE_FIELDS = [
  { key: "client_name", label: "Client Name", required: true },
  { key: "client_email", label: "Client Email", required: true },
  { key: "company_name", label: "Company Name", required: true },
  { key: "date_of_call", label: "Date of Call", required: false },
  {
    key: "client_needs_summary",
    label: "Summary of Client's Needs",
    required: true,
  },
  { key: "project_scope", label: "Project Scope", required: true },
  {
    key: "goals_and_objectives",
    label: "Goals and Objectives",
    required: true,
  },
  {
    key: "recommended_services",
    label: "Recommended Services or Deliverables",
    required: false,
  },
  { key: "proposed_timeline", label: "Proposed Timeline", required: false },
  { key: "estimated_pricing", label: "Estimated Pricing", required: false },
] as const;

export type IntakeFieldKey = (typeof INTAKE_FIELDS)[number]["key"];

export const SECTION_DEFS = [
  { key: "introduction", title: "1. Introduction" },
  { key: "proposed_solution", title: "2. Proposed Solution" },
  { key: "deliverables", title: "3. Deliverables" },
  { key: "timeline", title: "4. Timeline" },
  { key: "pricing", title: "5. Pricing" },
  { key: "next_steps", title: "6. Next Steps" },
] as const;

export type SectionKey = (typeof SECTION_DEFS)[number]["key"];

// The statuses in which a proposal's sections/intake are still the
// salesperson's working draft. Shared by the editor UI's `canEdit` check and
// every mutating section/intake route, so "can this be edited right now" is
// answered in exactly one place — a proposal that has moved past this (into
// review, approved, or sent) can't be edited via a direct API call just
// because the UI happens to hide the buttons for it.
export const EDITABLE_PROPOSAL_STATUSES = ["draft", "changes_requested", "generation_failed"] as const;

export function isEditableStatus(status: string): boolean {
  return (EDITABLE_PROPOSAL_STATUSES as readonly string[]).includes(status);
}

export const NEEDS_INPUT_MARKER = "[NEEDS INPUT";

export function contentNeedsInput(content: string): boolean {
  return content.includes(NEEDS_INPUT_MARKER);
}

export function missingRequiredFields(
  intake: Record<string, string | undefined>
): IntakeFieldKey[] {
  return INTAKE_FIELDS.filter(
    (f) => f.required && !intake[f.key]?.trim()
  ).map((f) => f.key);
}

// Shared status presentation, so the dashboard and the proposal detail page
// can never drift into showing two different labels/colors for the same
// status (they used to: the dashboard had colored badges, the detail page
// had plain text derived by a different formatting rule).
export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  approved: "Approved",
  changes_requested: "Changes requested",
  sent: "Sent",
  generation_failed: "Generation failed",
  document_failed: "Document failed",
  send_failed: "Send failed",
  rejected: "Rejected",
};

// A small color per status, rendered as a dot next to the label (dashboard
// list rows and the proposal detail header both use this) — deliberately a
// muted indicator rather than a filled, saturated badge, to match the rest
// of the app's restrained use of color.
export const STATUS_DOT: Record<string, string> = {
  draft: "bg-zinc-400",
  pending_review: "bg-amber-500",
  approved: "bg-blue-500",
  changes_requested: "bg-orange-500",
  sent: "bg-green-500",
  generation_failed: "bg-red-500",
  document_failed: "bg-red-500",
  send_failed: "bg-red-500",
  rejected: "bg-red-500",
};
