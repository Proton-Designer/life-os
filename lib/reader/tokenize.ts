// The ONE tokenizer for reader word indexes. Server (doc builder) and client (reader) must both
// use it; changing it invalidates every stored position/highlight, so bump READER_DOC_VERSION.

export function tokenizeBlock(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}
