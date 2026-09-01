"use client";

import { useState, useTransition } from "react";
import { Moon, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StepShell } from "./step-shell";
import { searchCities } from "@/app/(app)/settings/location-actions";
import { formatCityLabel, type CityMatch } from "@/lib/settings/location";
import type { FaithConfig } from "./types";

// Onboarding asks for the city and nothing else. Calculation method and Asr
// madhab are real settings with sane defaults (MWL / standard) and live in
// Settings — a brand-new user cannot yet have an opinion about either, and
// M3 asks only what a domain actually needs to start working.
//
// The city is a REAL search against the bundled city dataset + geocoder
// (the same searchCities the Settings screen uses), not free text: prayer
// times need lat/lng/timezone, and a typed string yields none of them.
export function FaithStep({
  onBack,
  onNext,
  progressTotal,
  progressIndex,
}: {
  onBack: () => void;
  onNext: (config: FaithConfig) => void;
  progressTotal: number;
  progressIndex: number;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CityMatch[]>([]);
  const [selected, setSelected] = useState<CityMatch | null>(null);
  const [searched, setSearched] = useState(false);
  const [isSearching, startSearching] = useTransition();

  function runSearch() {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    startSearching(async () => {
      const result = await searchCities(trimmed);
      setCandidates(result);
      setSearched(true);
    });
  }

  function choose(city: CityMatch) {
    setSelected(city);
    setCandidates([]);
    setQuery(formatCityLabel(city));
  }

  return (
    <StepShell
      stepId="personal_growth-faith"
      accent="deen"
      icon={Moon}
      eyebrow="Personal Growth · Faith"
      progressTotal={progressTotal}
      progressIndex={progressIndex}
      footer={
        <div className="flex gap-2">
          <Button type="button" variant="outline" data-testid="onboarding-back" onClick={onBack}>
            Back
          </Button>
          <Button
            type="button"
            data-testid="onboarding-next"
            disabled={!selected}
            onClick={() =>
              selected &&
              onNext({
                location_label: formatCityLabel(selected),
                location_lat: selected.lat,
                location_lng: selected.lng,
                timezone: selected.timezone,
              })
            }
          >
            Continue
          </Button>
        </div>
      }
    >
      <h1 className="text-xl font-semibold">Where are you?</h1>
      <p className="text-sm text-muted-foreground">
        We use this to compute accurate prayer times. You can change the calculation method
        later in Settings.
      </p>

      <div className="flex gap-2">
        <Input
          data-testid="faith-location-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setSearched(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
          placeholder="Search your city"
          autoFocus
          aria-label="Search your city"
        />
        <Button
          type="button"
          variant="outline"
          data-testid="faith-location-search"
          onClick={runSearch}
          disabled={query.trim().length < 2 || isSearching}
          aria-label="Search"
        >
          <Search className="size-4" aria-hidden />
        </Button>
      </div>

      {isSearching ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : candidates.length > 0 ? (
        <ul data-testid="faith-location-results" className="flex flex-col gap-1">
          {candidates.map((c) => (
            <li key={`${c.city}-${c.province}-${c.country}-${c.lat}-${c.lng}`}>
              <button
                type="button"
                data-testid="faith-location-result"
                onClick={() => choose(c)}
                className="w-full rounded-md border border-border/40 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {formatCityLabel(c)}
              </button>
            </li>
          ))}
        </ul>
      ) : searched && !selected ? (
        // Not an error state: "we don't have that one" is a fact about the
        // dataset, not a failure by the user.
        <p data-testid="faith-location-empty" className="text-sm text-muted-foreground">
          No match for that. Try the nearest larger city.
        </p>
      ) : null}

      {selected ? (
        <p data-testid="faith-location-selected" className="text-sm text-muted-foreground">
          Prayer times will be calculated for{" "}
          <span className="font-medium text-foreground">{formatCityLabel(selected)}</span>.
        </p>
      ) : null}
    </StepShell>
  );
}
