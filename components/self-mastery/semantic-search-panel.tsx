"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchSelfMasteryLibrary, type SearchLibraryResult } from "@/app/(app)/self-mastery/search-actions";

/**
 * P2-13D -- search box for the Self-Mastery library. Same shape as
 * TeachBackPanel (useState + useTransition over a thin server action, no
 * open-ended chat loop): one query in, one result set back.
 *
 * THREE RENDER STATES, ALL HONEST, NONE A DEAD END (mirrors this file's
 * sibling AI-gated panels): `semantic` (a real BYOK-embedded ranked
 * result), `text` (no embeddings-capable key -- a real, working plain
 * substring search over the same content, not a stub), `unavailable` (a
 * key exists but the call itself failed -- shown as the provider's own
 * message, never silently swapped for a text result that would look like
 * the query just didn't match).
 */
export function SemanticSearchPanel() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchLibraryResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResult(null);
      return;
    }
    startTransition(async () => {
      setResult(await searchSelfMasteryLibrary(trimmed));
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card p-4">
      <h3 className="text-sm font-medium">Search your library</h3>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across everything you've read…"
          className="flex-1"
          aria-label="Search your library"
        />
        <Button type="submit" size="icon" variant="outline" disabled={isPending} aria-label="Search">
          <Search />
        </Button>
      </form>

      {isPending ? <p className="text-xs text-muted-foreground">Searching…</p> : null}

      {!isPending && result?.mode === "unavailable" ? <p className="text-xs text-muted-foreground">{result.message}</p> : null}

      {!isPending && result && result.mode !== "unavailable" && result.hits.length === 0 ? (
        <p className="text-xs text-muted-foreground">No matches in your library.</p>
      ) : null}

      {!isPending && result && result.mode !== "unavailable" && result.hits.length > 0 ? (
        <div className="flex flex-col gap-2">
          {result.mode === "text" ? (
            <p className="text-xs text-muted-foreground">
              Add an OpenAI or Google key in Settings for ranked semantic search — showing plain text matches for now.
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {result.hits.map((hit) => (
              <li key={hit.chunkId} className="rounded-lg border border-border/40 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-foreground">{hit.bookTitle}</span>
                  {hit.pageStart !== null ? <span className="shrink-0 text-[11px] text-muted-foreground">p.{hit.pageStart}</span> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{hit.excerpt}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
