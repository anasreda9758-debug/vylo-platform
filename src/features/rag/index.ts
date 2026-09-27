import postgres from "postgres";
import { chunkText, type Chunk } from "./chunker";
import { BM25Index } from "./search";
import { cleanedSource } from "../review/source-cleaner";

let globalIndex: BM25Index | null = null;
let indexBuiltAt = 0;
const REBUILD_INTERVAL = 10 * 60 * 1000;

export async function getRAGIndex(): Promise<BM25Index> {
  if (globalIndex && Date.now() - indexBuiltAt < REBUILD_INTERVAL) {
    return globalIndex;
  }
  return rebuildIndex();
}

export async function rebuildIndex(): Promise<BM25Index> {
  const client = postgres(process.env.DATABASE_URL ?? "postgres://postgres:lms_dev@localhost:5432/lms");

  const meta = await client`
    SELECT l.id as lid, l.title as ltitle, m.slug as mslug
    FROM lecture l JOIN module m ON m.id = l.module_id
    WHERE length(l.content) > 100 ORDER BY l.id
  `;

  const allChunks: Chunk[] = [];
  let chunkId = 0;

  for (const m of meta) {
    const [row] = await client`SELECT content FROM lecture WHERE id = ${m.lid}`;
    if (!row?.content) continue;

    // Index only study content. Raw slide text carries bibliography, department
    // furniture and learning objectives, and a retrieval hit must never quote
    // them back to a student.
    const content = cleanedSource((row.content as string).replace(/\x00/g, "").slice(0, 8000), {
      title: (m.ltitle as string) ?? "",
    });
    if (!content) continue;

    const pieces = chunkText(content, { chunkSize: 600, overlap: 100 });
    for (const piece of pieces) {
      allChunks.push({
        id: `c${chunkId++}`,
        text: piece,
        lectureId: m.lid as string,
        lectureTitle: m.ltitle as string,
        moduleSlug: m.mslug as string,
        startOffset: 0,
      });
    }
  }

  await client.end();

  const index = new BM25Index();
  index.build(allChunks);
  globalIndex = index;
  indexBuiltAt = Date.now();

  console.log(`[RAG] Index built: ${allChunks.length} chunks from ${meta.length} lectures`);
  return index;
}

const MIN_SCORE = 0.1;

export function retrieve(
  index: BM25Index,
  query: string,
  opts?: { topK?: number; moduleSlug?: string },
): { chunk: Chunk; score: number }[] {
  // Fetch more candidates than needed so we can filter + dedup
  const fetchK = (opts?.topK ?? 6) * 3;
  let results = index.search(query, fetchK);

  // Filter by moduleSlug FIRST (before dedup) so relevant chunks aren't lost
  if (opts?.moduleSlug) {
    results = results.filter((r) => r.chunk.moduleSlug === opts.moduleSlug);
  }

  // Filter out very low scoring chunks
  results = results.filter((r) => r.score >= MIN_SCORE);

  // Deduplicate: keep highest scoring chunk per lectureId
  const seen = new Map<string, { chunk: Chunk; score: number }>();
  for (const r of results) {
    const existing = seen.get(r.chunk.lectureId);
    if (!existing || r.score > existing.score) {
      seen.set(r.chunk.lectureId, r);
    }
  }

  // Return topK from deduplicated results
  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, opts?.topK ?? 6);
}
