import { describe, expect, it, beforeEach, vi } from "vitest";
import { readLockInMinimized, writeLockInMinimized } from "../lock-in-storage";

describe("lock-in-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing has been stored yet", () => {
    expect(readLockInMinimized("s1")).toBeNull();
  });

  it("round-trips true and false", () => {
    writeLockInMinimized("s1", true);
    expect(readLockInMinimized("s1")).toBe(true);
    writeLockInMinimized("s1", false);
    expect(readLockInMinimized("s1")).toBe(false);
  });

  it("keys by session id — one session's flag never leaks into another's", () => {
    writeLockInMinimized("s1", true);
    expect(readLockInMinimized("s2")).toBeNull();
  });

  it("read returns null (not a thrown error) when localStorage.getItem throws — private window", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readLockInMinimized("s1")).toBeNull();
    vi.restoreAllMocks();
  });

  it("write is a silent no-op (not a thrown error) when localStorage.setItem throws — private window", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => writeLockInMinimized("s1", true)).not.toThrow();
    vi.restoreAllMocks();
  });
});
