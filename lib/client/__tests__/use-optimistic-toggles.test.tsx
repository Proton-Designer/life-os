import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOptimisticToggles } from "../use-optimistic-toggles";
import { resetKeyedQueuesForTests } from "../keyed-queue";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useOptimisticToggles", () => {
  beforeEach(() => resetKeyedQueuesForTests());

  it("shows the new value at once, writes absolute values in tap order, confirms the last one", async () => {
    const first = deferred();
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockImplementation(async () => {});
    const onConfirmed = vi.fn();
    const { result } = renderHook(() => useOptimisticToggles({ queuePrefix: "t", write, onConfirmed }));
    act(() => void result.current.set("a", true));
    act(() => void result.current.set("a", false));
    expect(result.current.value("a", false)).toBe(false);
    await waitFor(() => expect(write).toHaveBeenNthCalledWith(1, "a", true));
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve());
    await waitFor(() => expect(write).toHaveBeenNthCalledWith(2, "a", false));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith("a", false));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("ids are independent: a pending id does not hold another one back", async () => {
    const never = deferred();
    const write = vi.fn().mockImplementationOnce(() => never.promise).mockImplementation(async () => {});
    const { result } = renderHook(() => useOptimisticToggles({ queuePrefix: "t", write }));
    act(() => void result.current.set("a", true));
    await act(async () => {
      await result.current.set("b", true);
    });
    expect(write).toHaveBeenCalledWith("b", true);
    expect(result.current.value("a", false)).toBe(true);
  });

  it("a failed write reverts only that id and sets error; nothing is confirmed", async () => {
    const write = vi.fn(async (id: string) => {
      if (id === "a") throw new Error("boom");
    });
    const onConfirmed = vi.fn();
    const { result } = renderHook(() => useOptimisticToggles({ queuePrefix: "t", write, onConfirmed }));
    await act(async () => {
      await Promise.all([result.current.set("a", true), result.current.set("b", true)]);
    });
    expect(result.current.value("a", false)).toBe(false);
    expect(result.current.error).toBe("boom");
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledWith("b", true);
  });
});
