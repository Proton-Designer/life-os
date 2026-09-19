// Shared shape between the onboarding UI and Engineer 1's server actions
// (app/(app)/onboarding/actions.ts). These are plain structural types, not
// imports from that file, so the frontend never blocks on the backend
// landing first — see PHASE-1-SPEC.md for the authoritative contract.

export type DomainKey = "personal_growth" | "work" | "school";

export type PersonalSubdomainKey = "faith" | "self_mastery" | "fitness";

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

export interface FaithConfig {
  location_label: string;
  // Prayer times need real coordinates and a timezone — a typed city string
  // yields none of them, so onboarding resolves a real CityMatch rather than
  // storing free text. Calculation method and Asr madhab are deliberately
  // absent: they default (MWL / standard) and are changed in Settings.
  location_lat: number;
  location_lng: number;
  timezone: string;
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
