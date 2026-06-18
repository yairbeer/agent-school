/**
 * Wizard step types and constants
 */

export type Step = "pick" | "preview" | "review" | "edit";

export const STEPS: { step: Step; label: string; description: string }[] = [
  { step: "pick", label: "Pick Project", description: "Select sessions to review" },
  { step: "preview", label: "Preview", description: "Browse conversations" },
  { step: "review", label: "Review", description: "LLM analysis of friction" },
  { step: "edit", label: "Propose & Save", description: "Generate, edit & save AGENTS.md" },
];
