import type { PageDoc, TextLine } from "./pageParse";
import { dedupeRepeatedPhrase } from "./pageParse";
import { NUMBERED_STEM, stemNumber, stemBody, OPTION_LINE, PACKED_OPTIONS, matchPromptFamily, looksLikeAnswerLine, isQuestionPage, isContinuationFragment, mergeWrappedCaptions, type PageClass } from "./classifyPage";
import type { CorpusDoc } from "./corpus";

export type PointerMode = "SOURCE" | "MANUAL";

export type QuestionType =
  | "IMAGE_IDENTIFY_STRUCTURE"
  | "IMAGE_IDENTIFY_PART"
  | "IMAGE_RELATED_STRUCTURE"
  | "IMAGE_SURFACE_ANATOMY"
  | "IMAGE_MARKED_REGION"
  | "IMAGE_DIAGNOSIS"
  | "IMAGE_LAB_IDENTIFICATION"
  | "DEVICE_IDENTIFICATION"
  | "PROCEDURE"
  | "ECG_IDENTIFICATION"
  | "TEXT_OR_IMAGE_MCQ"
  | "HISTOLOGY_LABEL";

export type AnswerSource =
  | "EXPLICIT_SOURCE_TEXT"
  | "SOURCE_MCQ_KEY"
  | "SOURCE_LABEL_NEAR_MARKER"
  | "DERIVED_FROM_STEM"
  | "NONE";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type DetectedQuestion = {
  id: string;
  sourcePdf: string;
  sourcePage: number;
  sourceQuestionNumber: number | null;
  module: string | null;
  subject: string | null;
  /** Verbatim source stem — never rewritten. */
  stem: string;
  /** Which prompt family matched, for traceability. */
  promptKind: string | null;
  questionType: QuestionType;
  pointerMode: PointerMode;
  answer: string | null;
  answerSource: AnswerSource;
  answerConfidence: Confidence;
  /** Options exactly as they appear in the source, when the source has them. */
  sourceOptions: string[] | null;
  options: string[];
  correctOptionId: string | null;
  needsReview: boolean;
  warnings: string[];
  stemRect: { x: number; y: number; width: number; height: number } | null;
  markerPoints: { x: number; y: number }[];
};

/** Vertical distance within which a following line is treated as the answer. */
const ANSWER_GAP = 46;
/** A new question must start at least this far below the previous answer. */
const QUESTION_GAP = 55;
/**
 * Horizontal tolerance for "same diagram region". Captions and their answers
 * share a column; a caption must never be graded against text from the
 * neighbouring panel.
 */
const REGION_X_TOLERANCE = 150;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * True when a candidate "answer" is really the question's own wording — e.g. a
 * caption that wrapped across two baselines ("Inferior aperture of thorax" /
 * "(thoracic outlet) is bounded by:") where the tail gets mistaken for the
 * answer. Grading a question against its own stem is always wrong.
 */
export function isSelfEcho(candidate: string, stem: string): boolean {
  const c = norm(candidate);
  const s = norm(stem);
  if (!c || !s) return false;
  if (c === s) return true;
  if (c.length >= 8 && s.includes(c)) return true;
  if (s.length >= 8 && c.includes(s)) return true;
  return false;
}

export type QuestionTypeDecision = { type: QuestionType; family: string | null };

/**
 * Maps a source stem onto a question type WITHOUT changing the stem.
 * Semantics are preserved: a branch/origin question stays a relation question,
 * a diagnosis question stays a diagnosis question.
 */
export function inferQuestionType(stem: string, opts: { hasOptions: boolean; subject?: string | null }): QuestionTypeDecision {
  const family = matchPromptFamily(stem);
  if (opts.hasOptions) return { type: "TEXT_OR_IMAGE_MCQ", family };
  switch (family) {
    case "part":
      return { type: "IMAGE_IDENTIFY_PART", family };
    case "lab":
      return { type: "IMAGE_LAB_IDENTIFICATION", family };
    case "diagnosis":
      return { type: "IMAGE_DIAGNOSIS", family };
    case "surface_anatomy":
      return { type: "IMAGE_SURFACE_ANATOMY", family };
    case "relation":
    case "branch_of":
    case "origin":
      return { type: "IMAGE_RELATED_STRUCTURE", family };
    case "labelled_structure":
      // Histology/Ibl corpora use "identify the labeled structure" over
      // labelled micrographs; keep that distinction explicit.
      if (/histol|immune|blood|lymph|tissue|cell/i.test(opts.subject ?? "")) {
        return { type: "HISTOLOGY_LABEL", family };
      }
      return { type: "IMAGE_IDENTIFY_STRUCTURE", family };
    case "feature":
      return { type: "IMAGE_DIAGNOSIS", family };
    default:
      return { type: "IMAGE_IDENTIFY_STRUCTURE", family };
  }
}

type LineInfo = { line: TextLine; index: number; y: number; x: number; text: string };

function collectMarkerPoints(page: PageDoc): { x: number; y: number }[] {
  // A bare "?" is the corpus-wide source marker convention.
  const pts: { x: number; y: number }[] = [];
  for (const l of page.lines) {
    if (l.text.trim() === "?" || /^\?\s*$/.test(l.text)) {
      pts.push({ x: l.x, y: l.y });
    }
  }
  return pts;
}

/** Reads MCQ options packed onto one line ("A. x B. y C. z"). */
function parsePackedOptions(text: string): string[] {
  const out: string[] = [];
  const parts = text.split(PACKED_OPTIONS).filter((s) => s !== undefined);
  // split with a capture group yields [pre, letter, body, letter, body, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i + 1] ?? "").trim().replace(/[.\s]+$/, "");
    if (body) out.push(body);
  }
  return out;
}

export type DetectOptions = {
  doc: CorpusDoc;
  pageClass: PageClass;
};

export function detectQuestionsOnPage(page: PageDoc, doc: CorpusDoc, pageClass: PageClass): DetectedQuestion[] {
  if (!isQuestionPage(pageClass)) return [];

  // Captions wrapped across baselines are rejoined BEFORE detection so that a
  // caption tail is never mistaken for a stem or for an answer.
  const rawLines: LineInfo[] = page.lines.map((line, index) => ({ line, index, y: line.y, x: line.x, text: line.text }));
  const merged = mergeWrappedCaptions(rawLines, { maxGap: 40 });
  const lines: LineInfo[] = merged.map((l) => ({ ...l, text: dedupeRepeatedPhrase(l.text).replace(/\s+/g, " ").trim() }));
  const markerPoints = collectMarkerPoints(page);
  const out: DetectedQuestion[] = [];

  let i = 0;
  let seq = 0;
  while (i < lines.length) {
    const cur = lines[i];
    const numbered = NUMBERED_STEM.exec(cur.text);
    const family = matchPromptFamily(cur.text);

    if (!numbered && !family) {
      i += 1;
      continue;
    }

    // The source frequently draws the caption twice; keep one copy.
    const rawStem = numbered ? stemBody(cur.text) : cur.text;
    const stem = dedupeRepeatedPhrase(rawStem).replace(/\s+/g, " ").trim();

    const qNumber = numbered ? stemNumber(cur.text) : null;
    if (stem.length < 3) {
      i += 1;
      continue;
    }
    // Don't treat a family-matching line as a new question when it is the
    // ANSWER to the previous one (e.g. answer text that happens to start with
    // "Identify ..." is not expected, but guard anyway by y-gap).
    if (out.length > 0) {
      const prev = out[out.length - 1];
      const prevAnswerY = prev.answer ? prev.stemRect!.y - prev.stemRect!.height : prev.stemRect!.y;
      if (cur.y > prevAnswerY && prevAnswerY - cur.y < QUESTION_GAP && prev.stemRect && cur.y < prev.stemRect.y) {
        i += 1;
        continue;
      }
    }

    // ---- gather following lines until the next question start ----
    const body: LineInfo[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const nx = lines[j];
      if (NUMBERED_STEM.test(nx.text) || matchPromptFamily(nx.text)) break;
      if (cur.y - nx.y > 420) break; // far below => different region
      body.push(nx);
      j += 1;
    }

    // ---- options ----
    const sourceOptions: string[] = [];
    for (const b of body) {
      const one = OPTION_LINE.exec(b.text);
      if (one) {
        sourceOptions.push(one[2].trim().replace(/[.\s]+$/, ""));
        continue;
      }
      if (sourceOptions.length === 0) {
        const packed = parsePackedOptions(b.text);
        if (packed.length >= 3) sourceOptions.push(...packed);
      }
    }

    // ---- answer ----
    let answer: string | null = null;
    let answerSource: AnswerSource = "NONE";
    let answerConfidence: Confidence = "LOW";
    const warnings: string[] = [];

    if (sourceOptions.length >= 3) {
      // Source MCQ: the correct option is whichever the source marks. When the
      // source does not mark one, the answer is UNKNOWN and must be reviewed.
      const marked = body
        .map((b) => OPTION_LINE.exec(b.text))
        .filter((m): m is RegExpExecArray => Boolean(m))
        .map((m) => ({ letter: m[1].toUpperCase(), body: m[2].trim() }))
        .filter((o) => /\(correct\)|✓|✔|\*\s*$|answer/i.test(o.body));
      if (marked.length === 1) {
        answer = marked[0].body.replace(/\(correct\)|✓|✔/gi, "").trim();
        answerSource = "SOURCE_MCQ_KEY";
        answerConfidence = "HIGH";
      } else {
        warnings.push("source MCQ has no explicit correct-option marker");
      }
    }

    if (answer === null) {
      // Deterministic answer = the first answer-like line within ANSWER_GAP
      // that sits in the SAME horizontal region as the question caption.
      // Without the x-band check, a caption at x=44 happily "answers" itself
      // with the tail of its own sentence.
      const sameRegion = (x: number) => Math.abs(x - cur.line.x) <= REGION_X_TOLERANCE;
      const cand = body.find(
        (b) =>
          cur.y - b.y <= ANSWER_GAP &&
          b.y < cur.y - 2 &&
          sameRegion(b.line.x) &&
          !isContinuationFragment(b.text) &&
          looksLikeAnswerLine(b.text),
      );
      if (cand) {
        const cleaned = cand.text.trim().replace(/\s*\?\s*$/, "").replace(/[.\s]+$/, "");
        if (isSelfEcho(cleaned, stem)) {
          warnings.push("rejected an 'answer' that only echoes the question stem");
        } else {
          answer = cleaned;
          answerSource = "EXPLICIT_SOURCE_TEXT";
          answerConfidence = "HIGH";
        }
      }
    }

    if (answer === null && markerPoints.length > 0) {
      // Fall back to the structure label sitting nearest a "?" marker.
      let best: { text: string; d: number } | null = null;
      for (const b of body.length ? body : lines) {
        if (!looksLikeAnswerLine(b.text)) continue;
        for (const m of markerPoints) {
          const d = Math.hypot(b.line.x - m.x, b.y - m.y);
          if (!best || d < best.d) best = { text: b.text.trim(), d };
        }
      }
      if (best) {
        answer = best.text.replace(/\s*\?\s*$/, "").replace(/[.\s]+$/, "");
        answerSource = "SOURCE_LABEL_NEAR_MARKER";
        answerConfidence = best.d < 120 ? "MEDIUM" : "LOW";
      }
    }

    if (answer === null) {
      answerSource = "NONE";
      answerConfidence = "LOW";
      warnings.push("no deterministic answer found in source");
    }
    if (sourceOptions.length > 0 && sourceOptions.length !== 5) {
      warnings.push(`source supplied ${sourceOptions.length} option(s), not 5`);
    }

    const decision = inferQuestionType(stem, {
      hasOptions: sourceOptions.length >= 3,
      subject: doc.subjectGuess,
    });

    // Pointer mode: a usable source marker means NO manual arrow is required.
    const pageHasMarker = markerPoints.length > 0 || page.vectorOps >= 8;
    const pointerMode: PointerMode = pageHasMarker ? "SOURCE" : "MANUAL";
    if (pointerMode === "MANUAL") {
      warnings.push("no source marker detected; a manual marker would be required");
    }

    const id = `${doc.fileName}#p${page.page}#${seq + 1}`;
    out.push({
      id,
      sourcePdf: doc.fileName,
      sourcePage: page.page,
      sourceQuestionNumber: qNumber,
      module: doc.module,
      subject: doc.subjectGuess,
      stem,
      promptKind: decision.family,
      questionType: decision.type,
      pointerMode,
      answer,
      answerSource,
      answerConfidence,
      sourceOptions: sourceOptions.length ? sourceOptions : null,
      options: sourceOptions,
      correctOptionId: null,
      needsReview: answer === null || answerConfidence === "LOW" || pointerMode === "MANUAL",
      warnings,
      stemRect: { x: cur.line.x, y: cur.line.y, width: cur.line.width, height: cur.line.height },
      markerPoints,
    });

    seq += 1;
    i = j > i + 1 ? j : i + 1;
  }

  return out;
}
