import { ExternalLink } from "lucide-react";

/** "Open original" for a link import: the saved page in a new tab. Renders nothing without a safe http(s) url. */
export function OpenOriginalLink({ url }: { url: string | null }) {
  if (!url) return null;
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // safeOriginalUrl already validated; keep the raw text as the label
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="open-original"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      <ExternalLink className="size-3" aria-hidden />
      Open original ({host})
    </a>
  );
}
