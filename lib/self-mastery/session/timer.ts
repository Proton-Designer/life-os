// Elapsed-time tracking for the free-recall flow — ported near-verbatim from
// ULM's packages/core/src/session/timer.ts (pure, platform-agnostic, no
// timezone concerns at all, so nothing here needed adaptation). `elapsed_ms`
// is measured from prompt-shown to commit — thinking time, not wall-clock —
// and must not count time the app spent backgrounded. Web wires
// pause/resume to `visibilitychange`.

export interface TimerState {
  accumulatedMs: number;
  runningSinceMs: number | null;
}

export function startTimer(nowMs: number): TimerState {
  return { accumulatedMs: 0, runningSinceMs: nowMs };
}

export function pauseTimer(state: TimerState, nowMs: number): TimerState {
  if (state.runningSinceMs === null) return state;
  return { accumulatedMs: state.accumulatedMs + (nowMs - state.runningSinceMs), runningSinceMs: null };
}

export function resumeTimer(state: TimerState, nowMs: number): TimerState {
  if (state.runningSinceMs !== null) return state;
  return { ...state, runningSinceMs: nowMs };
}

export function elapsedMs(state: TimerState, nowMs: number): number {
  return state.accumulatedMs + (state.runningSinceMs !== null ? nowMs - state.runningSinceMs : 0);
}
