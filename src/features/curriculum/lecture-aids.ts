import { extractFacts, buildRichSummary, buildMindMap, type ConceptNode, type RichSummary } from "@/features/review/source-analysis";
import { cleanSourceText, classifyLine, linesToText } from "@/features/review/source-cleaner";
import { LABEL_ONLY_RE, stripCitation } from "@/features/review/source-signals";

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
 * True when a stored fragment still looks like study content.
 *
 * Aids generated before the source filter existed can carry bibliography lines,
 * department furniture and bare labels ("Anatomy department", "Anatomy for
 * Students. Elsevier."). Those must be recomputed from the cleaned lecture
 * instead of shown, so the reader stays correct even before the stored rows are
 * rewritten.
 */
const NOISE_CLASSES = new Set(["REFERENCE", "METADATA", "OBJECTIVE", "FOOTER", "NOISE"]);

/** Real noise: furniture that must never be shown to a student. */
const fragmentIsNoiseFree = (text: string | null | undefined, allowTitle: boolean): boolean => {
  if (!text) return true;
  return text
    .split(/[\n;•]/)
    .map((l) => l.trim())
    .filter(Boolean)
    .every((line) => {
      // "Key concepts", "ILOs", "Ground Rules" are section furniture, never a
      // concept a student should see as one.
      if (LABEL_ONLY_RE.test(line)) return false;
      const cleaned = stripCitation(line);
      if (!cleaned) return false;
      const cls = classifyLine(cleaned);
      // A short label may read as a slide title ("Chambers of the heart"), which
      // is normal for a mind-map branch, but a full sentence in that shape is
      // leftover source furniture.
      if (allowTitle) return !NOISE_CLASSES.has(cls);
      return cls !== "HEADER" && !NOISE_CLASSES.has(cls);
    });
};

const isCleanFragment = (text: string | null | undefined): boolean => fragmentIsNoiseFree(text, true);

/**
 * "This lecture focuses on X, Y, Z." is the shape every pre-filter summary
 * takes: a list of the slide titles, not what the lecture teaches. It carries no
 * medical claim of its own, so a stored overview in that form is an artifact.
 */
const GENERIC_OVERVIEW_RE = /^\s*this (?:lecture|topic|section)\s+(?:focuses on|covers|discusses|is about)\b/i;

const storedSummaryIsClean = (s: StoredSummary | null | undefined): boolean => {
  if (!s) return true;
  if (GENERIC_OVERVIEW_RE.test(s.overview ?? "")) return false;
  if (!fragmentIsNoiseFree(s.overview, false)) return false;
  return (
    (s.keyPoints ?? []).every((k) => fragmentIsNoiseFree(k, false)) &&
    (s.clinicalPearls ?? []).every((k) => fragmentIsNoiseFree(k, false))
  );
};

/** Depth-first walk over a stored concept tree, checking every label. */
const conceptTreeIsClean = (node: unknown, depth = 0): boolean => {
  if (depth > 8) return true;
  if (!node || typeof node !== "object") return true;
  const label = (node as { label?: unknown }).label;
  if (typeof label === "string" && !isCleanFragment(label)) return false;
  const children = (node as { children?: unknown }).children;
  if (!Array.isArray(children)) return true;
  return children.every((child) => conceptTreeIsClean(child, depth + 1));
};

/**
 * Lecture aids used by the reader page.
 *
 * Stored aids are used only while they are still clean. Anything the shared
 * source filter rejects is discarded and re-derived from the cleaned lecture
 * text, so a student never sees a hardcoded pilot or a pre-filter artifact
 * pretending to be their lecture.
 */
export type StoredAidStatus = {
  /** A stored mind map exists and the shared filter refuses it. */
  mapRejected: boolean;
  /** A stored summary exists and the shared filter refuses it. */
  summaryRejected: boolean;
};

/**
 * Which stored aids the shared source filter refuses.
 *
 * Shared with the one-off repair script so a bulk invalidation cannot drift
 * from what the reader page would reject.
 */
export const getStoredAidStatus = (params: {
  summaryJson: StoredSummary | null;
  mindmapJson: { label?: string; children?: unknown[] } | null;
}): StoredAidStatus => {
  const hasStoredMap = !!params.mindmapJson && Object.keys(params.mindmapJson).length > 0;
  const hasStoredSummary = !!params.summaryJson;
  return {
    mapRejected: hasStoredMap && !conceptTreeIsClean(params.mindmapJson),
    summaryRejected: hasStoredSummary && !(storedSummaryIsClean(params.summaryJson) && hasRealContent(params.summaryJson)),
  };
};

export const getLectureAids = (params: {
  title: string;
  moduleTitle?: string;
  content: string | null;
  summaryJson: StoredSummary | null;
  mindmapJson: { label?: string; children?: unknown[] } | null;
}): LectureAids => {
  const content = params.content ?? "";
  const cleaned = cleanSourceText(content, { title: params.title, moduleTitle: params.moduleTitle });
  const source = linesToText(cleaned.medicalLines.length ? cleaned.medicalLines : cleaned.contentLines);

  const hasStoredMap = !!params.mindmapJson && Object.keys(params.mindmapJson).length > 0;
  const mapOk = hasStoredMap && conceptTreeIsClean(params.mindmapJson);
  const storedMap = mapOk ? (params.mindmapJson as unknown as ConceptNode) : null;
  const summaryOk = storedSummaryIsClean(params.summaryJson) && hasRealContent(params.summaryJson);

  // "Rejected" means stored data exists and the filter refuses it, which is not
  // the same as there being no stored aid at all.
  const { mapRejected, summaryRejected } = getStoredAidStatus(params);

  // Both stored aids are present and still clean: use them untouched.
  if (mapOk && summaryOk) return { summary: null, mindMap: storedMap, derived: false };

  const facts = extractFacts(source, 40);
  if (!facts.length) {
    // Nothing to rebuild from. A stored aid that is still clean is the best
    // answer available; a rejected one stays out of the page, because `derived`
    // tells the reader not to fall back to the stored rows.
    return { summary: null, mindMap: storedMap, derived: mapRejected || summaryRejected };
  }

  // Each stored aid is replaced on its own: a dirty summary is rebuilt even when
  // the stored mind map is fine, and the other way round.
  const summary = buildRichSummary(facts, summaryOk ? (params.summaryJson?.overview ?? "") : "", params.title);
  const mindMap = mapOk ? storedMap : buildMindMap(facts, params.title, 8);
  return { summary, mindMap, derived: true };
};
