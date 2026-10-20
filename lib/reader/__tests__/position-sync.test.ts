import { describe, expect, it } from "vitest";
import { createPositionSync, type PositionPayload } from "../position-sync";

function setup() {
  const sent: PositionPayload[] = [];
  let timers: { fn: () => void; id: number }[] = [];
  let n = 0;
  const sync = createPositionSync({
    bookId: "b",
    send: (p) => sent.push(p),
    setTimer: (fn) => { timers.push({ fn, id: ++n }); return n; },
    clearTimer: (h) => { timers = timers.filter((t) => t.id !== h); },
  });
  return { sync, sent, fire: () => { const t = timers.shift(); t?.fn(); }, timerCount: () => timers.length };
}

describe("createPositionSync", () => {
  it("sends only the newest position when the timer fires", () => {
    const s = setup();
    s.sync.push(10, 1000, 300);
    s.sync.push(25, 2000, 350);
    expect(s.sent).toHaveLength(0);
    s.fire();
    expect(s.sent).toEqual([{ bookId: "b", wordIndex: 25, wpm: 350, clientUpdatedAt: new Date(2000).toISOString() }]);
  });
  it("flush sends immediately and clears the timer; a second flush sends nothing", () => {
    const s = setup();
    s.sync.push(7, 5000, 300);
    s.sync.flush();
    expect(s.sent).toHaveLength(1);
    expect(s.timerCount()).toBe(0);
    s.sync.flush();
    expect(s.sent).toHaveLength(1);
  });
  it("cancel drops the unsent position", () => {
    const s = setup();
    s.sync.push(7, 5000, 300);
    s.sync.cancel();
    s.sync.flush();
    expect(s.sent).toHaveLength(0);
  });
});
