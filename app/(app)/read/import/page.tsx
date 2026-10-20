import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { ImportReaderDialog } from "@/components/reader/import-reader-dialog";

const MAX_SHARED_TEXT = 200_000;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Landing for shared content (the PWA share target / "read this" links): /read/import?title=&text=&url=. Opens the
 * import dialog prefilled so the person confirms what is imported; nothing is created until they press Import.
 * A link wins over text when both are present (share sheets often send the page URL in `text`).
 */
export default async function ReadImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const title = first(sp.title).trim().slice(0, 200);
  const text = first(sp.text).slice(0, MAX_SHARED_TEXT);
  const urlParam = first(sp.url).trim();
  const textAsUrl = /^https?:\/\/\S+$/i.test(text.trim()) ? text.trim() : "";
  const url = urlParam || textAsUrl;
  const initial = url ? { tab: "link" as const, url, title } : text.trim() ? { tab: "paste" as const, text, title } : { tab: "file" as const, title };
  return (
    <PageContainer>
      <PageHeader title="Import to read" description="Check what you shared, then press Import." />
      <ImportReaderDialog defaultOpen initial={initial} />
    </PageContainer>
  );
}
