import { extractFacts, buildRichSummary, buildMindMap, type ConceptNode, type RichSummary } from "@/features/review/source-analysis";

/** Shape stored in `lecture.summaryJson`. */
export type StoredSummary = {
  overview?: string;
  keyPoints?: string[];
  clinicalPearls?: string[];
};

export type LectureAids = {
  summary: RichSummary | null;
  mindMap: ConceptNode | null;
  /** True when the aids were derived from the lecture text rather than stored. */
  derived: boolean;
};

const hasRealContent = (s: StoredSummary | null | undefined): boolean =>
  !!s && (!!s.overview?.trim() || (s.keyPoints?.length ?? 0) > 1);

/**
 * Lecture aids used by the reader page.
 *
 * Stored aids always win. Only when the lecture has no usable stored summary do
 * we derive a structured one from the lecture text, so the student never sees a
 * hardcoded pilot pretending to be their lecture.
 */
export const getLectureAids = (params: {
  title: string;
  content: string | null;
  summaryJson: StoredSummary | null;
  mindmapJson: { label?: string; children?: unknown[] } | null;
}): LectureAids => {
  const content = params.content ?? "";
  const hasMap = !!params.mindmapJson && Object.keys(params.mindmapJson).length > 0;
  const storedMap = hasMap ? (params.mindmapJson as unknown as ConceptNode) : null;

  // A stored mind map is always authoritative and must still be rendered.
  if (hasMap) return { summary: null, mindMap: storedMap, derived: false };

  const facts = extractFacts(content, 40);
  if (!facts.length) {
    return { summary: null, mindMap: null, derived: false };
  }

  const summary = buildRichSummary(facts, params.summaryJson?.overview ?? "", params.title);
  return { summary, mindMap: buildMindMap(facts, params.title), derived: true };
};
