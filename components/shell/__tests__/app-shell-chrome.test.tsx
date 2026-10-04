import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// NAV-02: the shell polls are fetches (lib/client/shell-fetch.ts), not Server Actions; route them to the same fakes.
vi.mock("@/lib/client/shell-fetch", () => ({
  shellFetch: async (path: string) => {
    if (path.startsWith("/api/shell/allocation-queue")) return { items: [], unknownCount: 0, timezone: "UTC" };
    if (path.startsWith("/api/shell/notifications")) return [];
    if (path.startsWith("/api/shell/distraction-count")) return 0;
    throw new Error(`unmocked shell fetch: ${path}`);
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));

// AppShellChrome renders AllocationCheckinGate, which calls this Server
// Action on mount to fetch the pending check-in queue — mocked so this
// stays the "fully client-testable through RTL" half of the shell (see the
// file's own header comment) rather than reaching for real Supabase env.
vi.mock("@/app/(app)/checkin/allocation-actions", () => ({
  saveAllocationCheckin: vi.fn(async () => {}),
}));

// NotificationsBell (topbar.tsx) calls this on mount — same
// fully-client-testable rationale as the allocation-actions mock above.
vi.mock("@/app/(app)/actions", () => ({
  signOut: vi.fn(),
}));

// RealtimeSyncProvider (mounted by AppShellChrome) calls createClient() and
// opens a channel on mount — stubbed so this stays a jsdom-only render with
// no real Supabase network reach, same rationale as the two mocks above.
const mockChannel = {
  on: vi.fn(function (this: unknown) {
    return this;
  }),
  subscribe: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    channel: vi.fn(() => mockChannel),
    removeChannel: vi.fn(),
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    realtime: { setAuth: vi.fn(async () => {}) },
  })),
}));

import { AppShellChrome } from "../app-shell-chrome";
import type { NavDomainState } from "@/lib/shell/nav-domain-state";

const ACCOUNT = { displayName: "Ayman", email: "ayman@example.com" };

function renderChrome(props: Partial<React.ComponentProps<typeof AppShellChrome>> = {}) {
  return render(
    <AppShellChrome
      account={ACCOUNT}
      userId="user-1"
      dateLabel="Fri, Aug 15"
      nowIso="2026-08-15T18:00:00.000-05:00"
      timezone="America/Chicago"
      deenMode
      activeWorkSession={null}
      killListSlots={[
        { id: null, text: "", completed: false },
        { id: null, text: "", completed: false },
        { id: null, text: "", completed: false },
      ]}
      onSaveDeen={async () => {}}
      onSaveBusiness={async () => {}}
      navMode="legacy"
      navDomainState={null}
      themePreset="oxblood"
      hiddenFeatures={[]}
      {...props}
    >
      <div>Page content</div>
    </AppShellChrome>
  );
}

describe("AppShellChrome", () => {
  it("renders the sidebar, topbar, mobile island, and page content", () => {
    renderChrome();

    expect(screen.getAllByRole("link", { name: "Life OS" })[0]).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("Fri, Aug 15")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-island-item-home")).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  // M6 failsafe, made provable rather than believed (Lead's ask,
  // 2026-09-01): a mode:"legacy" account — the state Ayman's real account
  // and the SEED account are both actually in — must render the exact same
  // nav destinations the app has always had. This is a real assertion on
  // the rendered DOM, not an eyeball comparison.
  it("mode:legacy renders every existing nav destination unchanged, not the four-tab nav", async () => {
    const user = userEvent.setup();
    renderChrome({ navMode: "legacy", navDomainState: null });

    for (const key of ["home", "deen", "business", "fitness", "school", "work"]) {
      expect(screen.getByTestId(`mobile-island-item-${key}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("tab-mobile-island")).not.toBeInTheDocument();

    // Insights/Settings links also render (hidden via CSS breakpoints, not
    // absence) in the desktop sidebar's icon-rail/expanded variants, both
    // always present in the DOM — so "reachable via More" is proven by the
    // popover adding links, not by asserting a single match exists.
    const insightsBefore = screen.queryAllByRole("link", { name: "Insights" }).length;
    await user.click(screen.getByTestId("mobile-island-item-more"));
    expect(screen.queryAllByRole("link", { name: "Insights" }).length).toBeGreaterThan(insightsBefore);
    expect(screen.queryAllByRole("link", { name: "Settings" }).length).toBeGreaterThan(0);
  });

  it("mode:domains renders only the selected domains as primary tabs, plus Home", async () => {
    const user = userEvent.setup();
    const navDomainState: NavDomainState = {
      hasPersonalGrowth: true,
      hasWork: false,
      hasSchool: true,
      personalSubdomains: [{ key: "fitness", label: "Fitness", kind: null }],
      workSubdomains: [],
    };
    renderChrome({ navMode: "domains", navDomainState });

    expect(screen.getByTestId("tab-mobile-island")).toBeInTheDocument();
    expect(screen.getByTestId("tab-mobile-island-item-home")).toBeInTheDocument();
    expect(screen.getByTestId("tab-mobile-island-item-personal")).toBeInTheDocument();
    expect(screen.getByTestId("tab-mobile-island-item-school")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-mobile-island-item-work")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mobile-island-item-deen")).not.toBeInTheDocument();

    const insightsBefore = screen.queryAllByRole("link", { name: "Insights" }).length;
    await user.click(screen.getByTestId("tab-mobile-island-item-more"));
    expect(screen.queryAllByRole("link", { name: "Insights" }).length).toBeGreaterThan(insightsBefore);
    expect(screen.queryAllByRole("link", { name: "Settings" }).length).toBeGreaterThan(0);
  });

  // THEME-01: the preset lives on <html> (ThemeRootScript before paint, ThemeRootSync on
  // navigation), NOT on a wrapper div: a closer ancestor attribute would override the
  // root one and stop an instant switch from reaching the shell.
  it("syncs the server preset onto <html> and puts no data-theme-preset on any wrapper", () => {
    document.documentElement.removeAttribute("data-theme-preset");
    const { container } = renderChrome({ themePreset: "ocean" });
    expect(document.documentElement.getAttribute("data-theme-preset")).toBe("ocean");
    expect(container.querySelector("[data-theme-preset]")).toBeNull();
  });

  it("hiddenFeatures removes the matching nav destination from the fixed icon row, without touching the others", () => {
    renderChrome({ navMode: "legacy", navDomainState: null, hiddenFeatures: ["business"] });

    expect(screen.queryByTestId("mobile-island-item-business")).not.toBeInTheDocument();
    for (const key of ["home", "deen", "fitness", "school", "work"]) {
      expect(screen.getByTestId(`mobile-island-item-${key}`)).toBeInTheDocument();
    }
  });

  it("hiddenFeatures never removes Home, even if somehow passed a bad value", () => {
    // FeatureId's own type excludes "home" (lib/features.ts) — this proves
    // the RUNTIME behavior holds too, not just the type.
    renderChrome({ navMode: "legacy", navDomainState: null, hiddenFeatures: ["home" as never] });
    expect(screen.getByTestId("mobile-island-item-home")).toBeInTheDocument();
  });
});
