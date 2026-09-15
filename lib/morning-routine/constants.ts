// Client-safe morning-routine constants. No `import "server-only"` here, on
// purpose: components/home/morning-routine-card.tsx ("use client") needs
// MAX_ROUTINE_ITEMS at runtime, and importing it from
// lib/morning-routine/actions-core.ts (server-only) would break the
// production build -- exactly the incident lib/habits/constants.ts's own
// header records for MAX_ACTIVE_HABITS (b63600b). actions-core.ts
// re-exports this so its server-side callers are unchanged -- one value,
// never a duplicated literal.
//
// This is a soft app-code ceiling, not a DB-enforced one (migration 188's
// own header: a checklist has no rank/slot for a scarcity index to refuse).
export const MAX_ROUTINE_ITEMS = 10;
