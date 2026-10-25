import type { AgentJobKind } from "./kinds";

/** Client-safe shapes for the agent-job UI. */
export type AgentJobState = "waiting" | "working" | "failed" | "ready_drafts";

export interface AgentJobDraft {
  prompt: string;
  answer: string;
  topic: string | null;
  sourceSnippet: string | null;
}

export interface AgentJobView {
  id: string;
  kind: AgentJobKind;
  state: AgentJobState;
  createdAt: string;
  error: string | null;
  drafts?: AgentJobDraft[];
}
