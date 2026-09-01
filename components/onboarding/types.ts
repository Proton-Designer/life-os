// Shared shape between the onboarding UI and Engineer 1's server actions
// (app/(app)/onboarding/actions.ts). These are plain structural types, not
// imports from that file, so the frontend never blocks on the backend
// landing first — see PHASE-1-SPEC.md for the authoritative contract.

export type DomainKey = "personal_growth" | "work" | "school";

export type PersonalSubdomainKey = "faith" | "self_mastery" | "fitness";

export type WorkSubdomainKind = "job" | "business";

export type SchoolSource = "upload" | "manual" | "canvas";

export interface SubdomainInput {
  key: string;
  label: string;
  kind?: WorkSubdomainKind;
  widgets?: string[];
  config?: Record<string, unknown>;
}

export interface FaithConfig {
  location_label: string;
  prayer_calc_method: string;
  asr_madhab: "standard" | "hanafi";
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
