import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/work/co-op",
  useRouter: () => ({ replace, push, refresh }),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockLink(
      { href, prefetch: _p, children, ...rest }: React.ComponentPropsWithoutRef<"a"> & { prefetch?: unknown },
      ref: React.Ref<HTMLAnchorElement>
    ) {
      return (
        <a ref={ref} href={href} {...rest}>
          {children}
        </a>
      );
    }),
    useLinkStatus: () => ({ pending: false }),
  };
});
vi.mock("@/components/shell/add-work-subdomain-dialog", () => ({ AddWorkSubdomainDialog: () => null }));

const saveWorkTabs = vi.fn(async (..._a: unknown[]) => {});
const ensureBusinessWorkTab = vi.fn(async () => ({ key: "business", created: true }));
const refreshWorkViews = vi.fn(async () => {});
vi.mock("@/app/(app)/work/subdomain-actions", () => ({
  saveWorkTabs: (...a: unknown[]) => saveWorkTabs(...a),
  ensureBusinessWorkTab: () => ensureBusinessWorkTab(),
  refreshWorkViews: () => refreshWorkViews(),
}));

import { WorkTabsBar, type WorkTab } from "../work-tabs-bar";
import { resetKeyedQueuesForTests } from "@/lib/client/keyed-queue";
import { resetDeferredRefreshForTests } from "@/lib/client/deferred-refresh";

const TABS: WorkTab[] = [
  { key: "co-op", label: "Co-op", kind: "job" },
  { key: "side", label: "Side", kind: "business" },
];

const tabLabels = () => screen.queryAllByTestId(/^work-subdomain-tab-/).map((e) => e.textContent?.trim());

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("edit-work-tabs-trigger"));
  return screen.getByTestId("edit-work-tabs-list");
}

describe("WorkTabsBar", () => {
  beforeEach(() => {
    [replace, push, refresh, saveWorkTabs, ensureBusinessWorkTab, refreshWorkViews].forEach((m) => m.mockClear());
    saveWorkTabs.mockImplementation(async () => {});
    resetKeyedQueuesForTests();
    resetDeferredRefreshForTests();
  });
  afterEach(() => resetDeferredRefreshForTests());

  it("renders the tabs in the given order, linking /work/<key>", () => {
    render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    expect(tabLabels()).toEqual(["Co-op", "Side"]);
    expect(screen.getByTestId("work-subdomain-tab-side")).toHaveAttribute("href", "/work/side");
  });

  it("rename + move saves ONE absolute edit by stable key, and the bar changes at once", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    saveWorkTabs.mockImplementation(() => new Promise<void>((r) => (release = r)));
    render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    const list = await openEditor(user);
    const name = within(list).getByLabelText("Name of tab 2");
    await user.clear(name);
    await user.type(name, "Studio");
    await user.click(within(list).getByRole("button", { name: "Move Studio up" }));
    await user.click(screen.getByTestId("edit-work-tabs-save"));

    // server write still pending, bar already reflects it
    expect(tabLabels()).toEqual(["Studio", "Co-op"]);
    await waitFor(() => expect(saveWorkTabs).toHaveBeenCalledTimes(1));
    expect(saveWorkTabs).toHaveBeenCalledWith([
      { key: "side", label: "Studio", archived: false },
      { key: "co-op", label: "Co-op", archived: false },
    ]);
    release();
  });

  it("the last remaining tab cannot be removed (positive control: with two tabs Remove is enabled)", async () => {
    const user = userEvent.setup();
    render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    const list = await openEditor(user);
    expect(within(list).getByRole("button", { name: "Remove Co-op" })).toBeEnabled();
    await user.click(within(list).getByRole("button", { name: "Remove Co-op" }));
    expect(within(list).getByRole("button", { name: "Remove Side" })).toBeDisabled();
  });

  it("removing the active tab sends it archived and moves to the first remaining tab", async () => {
    const user = userEvent.setup();
    render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    const list = await openEditor(user);
    await user.click(within(list).getByRole("button", { name: "Remove Co-op" }));
    await user.click(screen.getByTestId("edit-work-tabs-save"));
    // the tab strip hides itself with a single tab
    expect(tabLabels()).toEqual([]);
    expect(replace).toHaveBeenCalledWith("/work/side");
    await waitFor(() => expect(saveWorkTabs).toHaveBeenCalledWith([
      { key: "co-op", label: "Co-op", archived: true },
      { key: "side", label: "Side", archived: false },
    ]));
  });

  it("a failed save puts the bar back and shows an inline alert", async () => {
    const user = userEvent.setup();
    saveWorkTabs.mockRejectedValueOnce(new Error("saveWorkTabs: keep at least one Work tab"));
    render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    const list = await openEditor(user);
    await user.click(within(list).getByRole("button", { name: "Move Co-op down" }));
    await user.click(screen.getByTestId("edit-work-tabs-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("keep at least one");
    expect(tabLabels()).toEqual(["Co-op", "Side"]);
  });

  it("a blank name disables Save", async () => {
    const user = userEvent.setup();
    render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    const list = await openEditor(user);
    expect(screen.getByTestId("edit-work-tabs-save")).toBeEnabled();
    await user.clear(within(list).getByLabelText("Name of tab 1"));
    expect(screen.getByTestId("edit-work-tabs-save")).toBeDisabled();
  });

  it("two quick saves reach the server in order", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    saveWorkTabs.mockImplementation(async (...a: unknown[]) => {
      order.push(((a[0] as { label: string }[])[0]).label);
    });
    render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    for (const label of ["First", "Second"]) {
      const list = await openEditor(user);
      const name = within(list).getByLabelText("Name of tab 1");
      await user.clear(name);
      await user.type(name, label);
      await user.click(screen.getByTestId("edit-work-tabs-save"));
    }
    await waitFor(() => expect(order).toEqual(["First", "Second"]));
  });

  it("offers 'Add a Business tab' only when there is none, and opens the new tab", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<WorkTabsBar tabs={[TABS[0]]} activeKey="co-op" showSharedNote={false} />);
    await openEditor(user);
    await user.click(screen.getByTestId("add-business-tab"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/work/business"));
    unmount();

    render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    await openEditor(user);
    expect(screen.queryByTestId("add-business-tab")).toBeNull();
  });

  it("shows the shared-data note only with several tabs and when asked", () => {
    const { rerender } = render(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote />);
    expect(screen.getByTestId("work-shared-data-note")).toBeInTheDocument();
    rerender(<WorkTabsBar tabs={[TABS[0]]} activeKey="co-op" showSharedNote />);
    expect(screen.queryByTestId("work-shared-data-note")).toBeNull();
    rerender(<WorkTabsBar tabs={TABS} activeKey="co-op" showSharedNote={false} />);
    expect(screen.queryByTestId("work-shared-data-note")).toBeNull();
  });
});
