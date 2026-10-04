import { describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { revalidateBusinessScreens, revalidateWorkScreens } from "../revalidate-screens";

describe("revalidate-screens (WORK-W1 review F1/F2)", () => {
  it("a Business write also revalidates the Work-tab page that now serves the Business screen", () => {
    revalidatePath.mockClear();
    revalidateBusinessScreens();
    expect(revalidatePath).toHaveBeenCalledWith("/business");
    expect(revalidatePath).toHaveBeenCalledWith("/work/[subdomain]", "page");
  });
  it("a Work write revalidates /work and the tab page", () => {
    revalidatePath.mockClear();
    revalidateWorkScreens();
    expect(revalidatePath).toHaveBeenCalledWith("/work");
    expect(revalidatePath).toHaveBeenCalledWith("/work/[subdomain]", "page");
  });
});
