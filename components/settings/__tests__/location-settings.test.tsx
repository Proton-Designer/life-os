import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/(app)/settings/actions", () => ({
  updateProfile: vi.fn(async () => {}),
}));
vi.mock("@/app/(app)/settings/location-actions", () => ({
  searchCities: vi.fn(async () => []),
  getNearestCityLabel: vi.fn(async () => null),
}));
vi.mock("@/lib/prayer-times/calculate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/prayer-times/calculate")>("@/lib/prayer-times/calculate");
  return { ...actual, calculatePrayerTimes: vi.fn(actual.calculatePrayerTimes) };
});

import { updateProfile } from "@/app/(app)/settings/actions";
import { searchCities, getNearestCityLabel } from "@/app/(app)/settings/location-actions";
import { calculatePrayerTimes } from "@/lib/prayer-times/calculate";
import { localDateString } from "@/lib/date-utils";
import { LocationSettings } from "../location-settings";

const NO_LOCATION = { lat: null, lng: null, label: null, timezone: null };
const CHICAGO = { lat: 41.83, lng: -87.75, label: "Chicago, Illinois, United States of America", timezone: "America/Chicago" };

function setGeolocation(impl: (success: PositionCallback, error?: PositionErrorCallback) => void) {
  Object.defineProperty(window.navigator, "geolocation", {
    value: { getCurrentPosition: impl },
    configurable: true,
  });
}

describe("LocationSettings", () => {
  beforeEach(() => {
    vi.mocked(updateProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(searchCities).mockReset().mockResolvedValue([]);
    vi.mocked(getNearestCityLabel).mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    // @ts-expect-error -- test-only cleanup of a property we defined
    delete window.navigator.geolocation;
    vi.useRealTimers();
  });

  it("anchors the prayer-time preview to the local calendar day, not raw UTC — pinned at the UTC rollover (America/Chicago, UTC-5)", () => {
    // 18:59 and 19:01 CDT on 2026-08-30 are the same Chicago calendar day but
    // straddle midnight UTC (23:59 UTC Aug 30 vs 00:01 UTC Aug 31). Before the
    // fix, calculatePrayerTimes was handed a raw `new Date()`, so the second
    // instant computed Aug 31's prayer times instead of Aug 30's — the exact
    // bug class AGENTS.md documents. The anchor date passed to
    // calculatePrayerTimes must be identical across both instants.
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-08-30T23:59:00Z")); // 18:59 CDT
    render(<LocationSettings initial={CHICAGO} prayerCalcMethod="MWL" asrMadhab="standard" />);
    const beforeRolloverAnchor = vi.mocked(calculatePrayerTimes).mock.calls.at(-1)![0].date;

    vi.setSystemTime(new Date("2026-08-31T00:01:00Z")); // 19:01 CDT, same local day
    render(<LocationSettings initial={CHICAGO} prayerCalcMethod="MWL" asrMadhab="standard" />);
    const afterRolloverAnchor = vi.mocked(calculatePrayerTimes).mock.calls.at(-1)![0].date;

    expect(afterRolloverAnchor.getTime()).toBe(beforeRolloverAnchor.getTime());
    expect(localDateString(beforeRolloverAnchor, "UTC")).toBe("2026-08-30");
  });

  it("shows a no-location message when nothing is set yet", () => {
    render(<LocationSettings initial={NO_LOCATION} prayerCalcMethod="MWL" asrMadhab="standard" />);
    expect(screen.getByText(/no location set/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use my current location/i })).toBeInTheDocument();
  });

  it("shows the resolved place, timezone, and today's five prayer times when a location is set", () => {
    render(<LocationSettings initial={CHICAGO} prayerCalcMethod="MWL" asrMadhab="standard" />);
    expect(screen.getByText(CHICAGO.label)).toBeInTheDocument();
    expect(screen.getByText(/America\/Chicago/)).toBeInTheDocument();
    for (const name of ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // 5 time-like strings, one per prayer — exact values are lib/prayer-times'
    // job to get right and are unit-tested there; this just proves the wiring.
    const timeMatches = screen.getAllByText(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    expect(timeMatches.length).toBe(5);
  });

  it("saves an atomic update using the nearest-city label (offline reverse geocoding) on successful geolocation", async () => {
    setGeolocation((success) => {
      success({ coords: { latitude: 51.5, longitude: -0.12 } } as GeolocationPosition);
    });
    vi.mocked(getNearestCityLabel).mockResolvedValue("London, Westminster, United Kingdom");
    const user = userEvent.setup();
    render(<LocationSettings initial={NO_LOCATION} prayerCalcMethod="MWL" asrMadhab="standard" />);

    await user.click(screen.getByRole("button", { name: /use my current location/i }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledTimes(1);
    });
    expect(getNearestCityLabel).toHaveBeenCalledWith(51.5, -0.12);
    // The GPS coordinates saved are the caller's own — never the matched
    // city's centroid, even though the label came from that city.
    expect(updateProfile).toHaveBeenCalledWith({
      location_lat: 51.5,
      location_lng: -0.12,
      location_label: "London, Westminster, United Kingdom",
      timezone: expect.any(String),
    });

    await waitFor(() => {
      expect(screen.getByText("London, Westminster, United Kingdom")).toBeInTheDocument();
    });
  });

  it("falls back to a coordinate label when no city is close enough in the dataset", async () => {
    setGeolocation((success) => {
      success({ coords: { latitude: 0, longitude: -140 } } as GeolocationPosition); // mid-Pacific
    });
    vi.mocked(getNearestCityLabel).mockResolvedValue(null);
    const user = userEvent.setup();
    render(<LocationSettings initial={NO_LOCATION} prayerCalcMethod="MWL" asrMadhab="standard" />);

    await user.click(screen.getByRole("button", { name: /use my current location/i }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({
        location_lat: 0,
        location_lng: -140,
        location_label: "0.0000°N, 140.0000°W",
        timezone: expect.any(String),
      });
    });
  });

  it("shows a fallback message pointing at search when geolocation is denied, without leaving a spinner", async () => {
    setGeolocation((_success, error) => {
      error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1 } as GeolocationPositionError);
    });
    const user = userEvent.setup();
    render(<LocationSettings initial={NO_LOCATION} prayerCalcMethod="MWL" asrMadhab="standard" />);

    await user.click(screen.getByRole("button", { name: /use my current location/i }));

    await waitFor(() => {
      expect(screen.getByText(/search for your city below/i)).toBeInTheDocument();
    });
    expect(updateProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /use my current location/i })).not.toBeDisabled();
  });

  it("shows a fallback message immediately when geolocation isn't available in this browser at all", async () => {
    // No setGeolocation() call — navigator.geolocation is undefined, same as jsdom's default.
    const user = userEvent.setup();
    render(<LocationSettings initial={NO_LOCATION} prayerCalcMethod="MWL" asrMadhab="standard" />);

    await user.click(screen.getByRole("button", { name: /use my current location/i }));

    expect(screen.getByText(/search for your city below/i)).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("searches and renders candidate matches", async () => {
    vi.mocked(searchCities).mockResolvedValue([
      { city: "Chicago", province: "Illinois", country: "United States of America", lat: 41.83, lng: -87.75, timezone: "America/Chicago" },
    ]);
    const user = userEvent.setup();
    render(<LocationSettings initial={NO_LOCATION} prayerCalcMethod="MWL" asrMadhab="standard" />);

    await user.type(screen.getByRole("textbox", { name: /search for a city/i }), "Chicago");
    await user.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Chicago, Illinois, United States of America/i })).toBeInTheDocument();
    });
  });

  it("shows a no-matches message and does not save when the search returns nothing", async () => {
    vi.mocked(searchCities).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<LocationSettings initial={NO_LOCATION} prayerCalcMethod="MWL" asrMadhab="standard" />);

    await user.type(screen.getByRole("textbox", { name: /search for a city/i }), "Nowhereville");
    await user.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText(/no matches/i)).toBeInTheDocument();
    });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("saves an atomic update when a candidate is selected", async () => {
    vi.mocked(searchCities).mockResolvedValue([
      { city: "Chicago", province: "Illinois", country: "United States of America", lat: 41.83, lng: -87.75, timezone: "America/Chicago" },
    ]);
    const user = userEvent.setup();
    render(<LocationSettings initial={NO_LOCATION} prayerCalcMethod="MWL" asrMadhab="standard" />);

    await user.type(screen.getByRole("textbox", { name: /search for a city/i }), "Chicago");
    await user.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => screen.getByRole("button", { name: /Chicago, Illinois, United States of America/i }));
    await user.click(screen.getByRole("button", { name: /Chicago, Illinois, United States of America/i }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({
        location_lat: 41.83,
        location_lng: -87.75,
        location_label: "Chicago, Illinois, United States of America",
        timezone: "America/Chicago",
      });
    });
  });
});
