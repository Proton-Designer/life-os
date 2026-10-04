import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOptimisticItem } from "../use-optimistic-item";
import { resetKeyedQueuesForTests } from "../keyed-queue";

// Generic hook (PERF-2): independent of any feature's actions; the caller supplies
// the write and a data-free refresh action.
describe("useOptimisticItem (generic)", () => {
  beforeEach(() => resetKeyedQueuesForTests());

  it("flips instantly, writes absolute values in tap order, then runs refresh once", async () => {
    const write = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    const { result } = renderHook(() => useOptimisticItem<boolean>({ serverValue: false, queueKey: "k", write, refresh }));
    await act(async () => {
      void result.current.set(true);
      void result.current.set(false);
    });
    expect(result.current.value).toBe(false);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls.map((c) => (c as unknown[])[0])).toEqual([true, false]);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("a failed write reverts to the confirmed value and sets error", async () => {
    const write = vi.fn(async () => {
      throw new Error("nope");
    });
    const { result } = renderHook(() => useOptimisticItem<boolean>({ serverValue: false, queueKey: "k2", write }));
    await act(async () => {
      await result.current.set(true);
    });
    expect(result.current.value).toBe(false);
    expect(result.current.error).toBe("nope");
  });
});
