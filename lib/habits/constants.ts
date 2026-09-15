// Client-safe habit constants. No `import "server-only"` here, on purpose:
// components/habits/habit-list.tsx ("use client") needs MAX_ACTIVE_HABITS at
// runtime, and importing it from lib/habits/actions-core.ts (server-only)
// broke the production build (b63600b). actions-core.ts re-exports this so its
// server-side callers are unchanged — one value, never a duplicated literal.
//
// The real ceiling is the database's partial unique index on
// identity_habits (user_id, rank) WHERE status = 'active' (migration 175);
// this constant only mirrors it for the UI and the pre-insert check.
export const MAX_ACTIVE_HABITS = 7;
