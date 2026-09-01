// ULM's most distinctive component, adapted to LifeOS's own tokens — a
// highlighter wash with a left rule, the way a person marks a passage in a
// physical book. `chapter` is deliberately not a prop here: ULM's own
// component accepts one but never populates it anywhere (the data layer
// never selects section data), and their own lead's ruling was explicit —
// don't wire a field nobody fills in, a fake "Ch. 7" is worse than
// omitting it entirely.
export function ProvenanceQuote({ quote, pageRef }: { quote: string; pageRef?: number | null }) {
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
      {pageRef !== null && pageRef !== undefined ? (
        <p className="mt-2 text-xs text-muted-foreground">p. {pageRef}</p>
      ) : null}
    </div>
  );
}
