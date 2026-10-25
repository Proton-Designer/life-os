/** What the session closer shows under "Today": a line (with its source, when an agent wrote it) or the honest "no AI set up" state. Null = nothing to show. Client-safe (the overlay imports it). */
export type CloserDayConnectionResult = { kind: "line"; text: string; sourceLabel: string | null } | { kind: "no_ai" };
