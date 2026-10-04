// Shared shape between the onboarding UI and Engineer 1's server actions
// (app/(app)/onboarding/actions.ts). These are plain structural types, not
// imports from that file, so the frontend never blocks on the backend
// landing first — see PHASE-1-SPEC.md for the authoritative contract.

export type DomainKey = "personal_growth" | "work" | "school";

// No "faith": Deen Mode (Settings -> Features) is the only way into the Faith
// area. Onboarding never offers, asks about or writes it.
export type PersonalSubdomainKey = "self_mastery" | "fitness";

export type WorkSubdomainKind = "job" | "business";

// ONB item 10: "upload a syllabus" is no longer a top-level source -- folded
// into "manual" as an optional per-class attachment (see school-step.tsx).
export type SchoolSource = "manual" | "canvas";

export interface SubdomainInput {
  key: string;
  label: string;
  kind?: WorkSubdomainKind;
  widgets?: string[];
  config?: Record<string, unknown>;
}

export interface FitnessConfig {
  style: "plan" | "ad_hoc";
}

export interface WorkSubdomainDraft {
  key: string;
  label: string;
  kind: WorkSubdomainKind;
  widgets: string[];
}

export interface SchoolManualClass {
  name: string;
  code: string;
}
