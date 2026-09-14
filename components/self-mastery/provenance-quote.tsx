// ULM's most distinctive component, adapted to LifeOS's own tokens — a
// highlighter wash with a left rule, the way a person marks a passage in a
// physical book.
//
// `sectionTitle` (Phase 1 #8): the prior ruling here was that `chapter`
// stayed unwired because the data layer never populated it, and a fake
// "Ch. 7" is worse than omitting it entirely — that ruling still stands,
// unchanged. What changed is get-book-detail.ts now resolves a REAL title
// from `book_sections` via `lessons.section_id`, and collapses it to `null`
// itself (never here) for every case that isn't a genuine detected
// heading: no section, no title, or `parseStructure`'s own "Full Book"
// sentinel for "no real structure found." So this component still never
// guesses — it renders exactly what it's handed, or nothing.
export function ProvenanceQuote({
  quote,
  pageRef,
  sectionTitle,
}: {
  quote: string;
  pageRef?: number | null;
  sectionTitle?: string | null;
}) {
  const hasPageRef = pageRef !== null && pageRef !== undefined;
  const hasSectionTitle = sectionTitle !== null && sectionTitle !== undefined && sectionTitle.length > 0;
  return (
    <div
      className="rounded-r-md border-l-4 px-5 py-4"
      style={{
        borderColor: "var(--accent-deen)",
        backgroundColor: "color-mix(in oklch, var(--accent-deen) 10%, var(--card))",
      }}
    >
      {/* whitespace-pre-wrap + break-words, no line-clamp/truncation anywhere
          in this component — the Lead's explicit instruction: a user who
          taps through and can't see the full quote has lost the thing that
          makes AI-extracted content trustworthy. */}
      <p className="whitespace-pre-wrap break-words font-serif text-base italic text-foreground">&ldquo;{quote}&rdquo;</p>
      {hasSectionTitle || hasPageRef ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {hasSectionTitle ? sectionTitle : null}
          {hasSectionTitle && hasPageRef ? " · " : null}
          {hasPageRef ? `p. ${pageRef}` : null}
        </p>
      ) : null}
    </div>
  );
}
