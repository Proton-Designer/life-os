// LifeOS's own take on ULM's BookCover (deterministic per-book color from
// title/author, no cover images) — simplified to a flat chip rather than
// porting the "cloth and foil" font styling, since that's tuned to ULM's
// own Fraunces/Inter Tight fonts. `coverHue` comes from the DB when the
// worker has set it (post-ingestion); a book still uploading has none yet,
// so this derives a stable fallback from the title itself rather than
// showing an undifferentiated gray box.
function hueFromTitle(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) % 360;
  }
  return hash;
}

export function BookCoverChip({
  title,
  author,
  coverHue,
  size = "md",
}: {
  title: string;
  author?: string | null;
  coverHue?: number | null;
  size?: "sm" | "md" | "lg";
}) {
  const hue = coverHue ?? hueFromTitle(title);
  const sizeClass = size === "sm" ? "size-9" : size === "lg" ? "size-14" : "size-11";
  const initial = title.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      role="img"
      aria-label={author ? `${title} by ${author}` : title}
      className={`flex shrink-0 items-center justify-center rounded-lg font-serif font-semibold text-white ${sizeClass}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${hue} 55% 26%))`,
        fontSize: size === "sm" ? "0.9rem" : size === "lg" ? "1.4rem" : "1.1rem",
      }}
    >
      {initial}
    </div>
  );
}
