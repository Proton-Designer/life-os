// Client-safe: the guided flow offers this many routine steps (the full cap of 5 is on Home's Launch card). No
// "server-only" on purpose -- the dialog needs it at runtime, and lib/day-setup/actions-core.ts (server-only) re-exports
// nothing the client could import (same reason lib/habits/constants.ts exists).
export const MAX_SETUP_STEPS = 3;
