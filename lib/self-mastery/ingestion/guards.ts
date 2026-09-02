import type { ExtractedPage } from "./types";

export const MAX_PAGE_COUNT = 1500;
const SCANNED_PDF_MEAN_CHARS_THRESHOLD = 120;
const SCAN_SAMPLE_SIZE = 30;

export interface ScannedPdfCheck {
  isLikelyScanned: boolean;
  meanCharsPerPage: number;
  sampledPages: number;
}

/**
 * Detect an image-only/scanned PDF (no usable text layer) BEFORE spending
 * minutes on downstream stages. Samples rather than scanning every page so
 * a 1000+ page book doesn't pay for this check.
 */
export function detectScannedPdf(pages: ExtractedPage[]): ScannedPdfCheck {
  if (pages.length === 0) {
    return { isLikelyScanned: true, meanCharsPerPage: 0, sampledPages: 0 };
  }

  const step = Math.max(1, Math.floor(pages.length / SCAN_SAMPLE_SIZE));
  const sample: ExtractedPage[] = [];
  for (let i = 0; i < pages.length; i += step) {
    const page = pages[i];
    if (page) sample.push(page);
  }

  const totalChars = sample.reduce((sum, p) => sum + p.text.trim().length, 0);
  const meanCharsPerPage = totalChars / sample.length;

  return {
    isLikelyScanned: meanCharsPerPage < SCANNED_PDF_MEAN_CHARS_THRESHOLD,
    meanCharsPerPage,
    sampledPages: sample.length,
  };
}
