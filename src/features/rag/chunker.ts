export type Chunk = {
  id: string;
  text: string;
  lectureId: string;
  lectureTitle: string;
  moduleSlug: string;
  startOffset: number;
};

export function chunkText(
  text: string,
  opts: { chunkSize?: number; overlap?: number } = {},
): string[] {
  const chunkSize = opts.chunkSize ?? 800;
  const overlap = Math.min(opts.overlap ?? 150, chunkSize - 1);

  // Clean text
  const clean = text.replace(/\x00/g, "").replace(/\s+/g, " ").trim();
  if (clean.length === 0) return [];
  if (clean.length <= chunkSize) return [clean];

  const chunks: string[] = [];
  // Boundaries snap to a space so a chunk never starts or ends mid-word: a
  // half token both truncates the search snippet and pollutes the BM25 index
  // with fragments like "ce" or "gi".
  const nextSpace = (from: number): number => {
    const idx = clean.indexOf(" ", from);
    return idx === -1 ? clean.length : idx;
  };
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    if (end < clean.length) end = nextSpace(end);
    const chunk = clean.slice(start, end).trim();
    if (chunk.length > 20) chunks.push(chunk);
    if (end >= clean.length) break;
    let nextStart = nextSpace(end - overlap) + 1;
    // Safety: never stall, even when overlap swallows the whole window.
    if (nextStart <= start) nextStart = end;
    start = nextStart;
  }

  return chunks;
}
