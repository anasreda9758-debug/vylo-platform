import type { PageDoc } from "./pageParse";

export type PageClass =
  | "TITLE"
  | "THEORY"
  | "REFERENCE_IMAGE"
  | "REFERENCE_LABELLED_IMAGE"
  | "QUESTION_MCQ"
  | "QUESTION_SHORT_ANSWER"
  | "QUESTION_IMAGE"
  | "QUESTION_MIXED"
  | "UNKNOWN";

/**
 * Numbered-question stems. Deliberately anchored at line start so that a
 * number appearing mid-sentence ("...in 3 cases") is not treated as a stem.
 * Supports `Q1)`, `Q1:`, `Q 1`, `1)`, `1.` and `Question 1`.
 */
export const NUMBERED_STEM = /^\s*(?:Q(?:uestion)?\s*(\d{1,3})|(\d{1,3}))\s*(?:[.):]|(?=\s))/i;

/** Extracts the question number from a line that matched NUMBERED_STEM. */
export function stemNumber(line: string): number | null {
  const m = NUMBERED_STEM.exec(line);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The stem text with any leading question number removed. */
export function stemBody(line: string): string {
  return line.replace(NUMBERED_STEM, "").replace(/^\s*[.):]?\s*/, "").trim();
}

/**
 * Unnumbered repeated prompts used across the OSPE corpus. Each family keeps
 * its own meaning so the stem is never flattened into a generic
 * "identify the structure" sentence.
 */
export const PROMPT_FAMILIES: { re: RegExp; kind: string }[] = [
  { re: /^identify the (?:labeled|labelled) part of this (?:bone|structure)\b/i, kind: "part" },
  { re: /^identify the (?:labeled|labelled) structure\b/i, kind: "labelled_structure" },
  { re: /^identify (?:the )?structure (?:related|indicated) (?:to|by) this (?:area|region)\b/i, kind: "relation" },
  { re: /^identify the structure (?:indicated|pointed|shown)\b/i, kind: "structure" },
  { re: /^identify this (?:artery|vein|vessel|chamber|valve|nerve|bone|muscle|duct|space|structure|point|node)\b/i, kind: "named_structure" },
  { re: /^identify (?:the )?(?:named )?(?:artery|vein|vessel|chamber|valve|nerve|structure)\b/i, kind: "named_structure" },
  { re: /^this (?:artery|vein|vessel|nerve|structure|muscle|bone) is a branch (?:of|from)\b/i, kind: "branch_of" },
  { re: /^this (?:artery|vein|vessel|nerve) (?:is|arises|comes|originates)\b/i, kind: "origin" },
  { re: /^this point refers to surface anatomy of\b/i, kind: "surface_anatomy" },
  { re: /^surface anatomy of\b/i, kind: "surface_anatomy" },
  { re: /^what is the diagnosis\b/i, kind: "diagnosis" },
  { re: /^diagnosis\s*[?:]/i, kind: "diagnosis" },
  { re: /^identify the (?:organ|cell|tissue|lesion|abnormality|feature|sign)\b/i, kind: "feature" },
  { re: /^identify the (?:organism|medium|test|result|appearance)\b/i, kind: "lab" },
  { re: /^what is the (?:organism|diagnosis|condition|feature)\b/i, kind: "lab" },
  { re: /^(?:name|state) the\b/i, kind: "short_answer" },
  { re: /^which (?:of|one)\b/i, kind: "short_answer" },
];

export function matchPromptFamily(text: string): string | null {
  const t = text.trim();
  for (const fam of PROMPT_FAMILIES) {
    if (fam.re.test(t)) return fam.kind;
  }
  return null;
}

/** True when the line looks like an MCQ option row ("A. Manubrium sterni."). */
export const OPTION_LINE = /^\s*([A-E])\s*[.):]\s*(.+?)\s*$/i;

/** "A. x  B. y  C. z" packed onto one visual line. */
export const PACKED_OPTIONS = /(?:^|\s)([A-E])\s*[.):]\s*/g;

export function countOptionLetters(text: string): number {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  PACKED_OPTIONS.lastIndex = 0;
  while ((m = PACKED_OPTIONS.exec(text)) !== null) found.add(m[1].toUpperCase());
  return found.size;
}

/** An answer line is short, not a prompt, and not another question. */
export function looksLikeAnswerLine(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 120) return false;
  if (NUMBERED_STEM.test(t)) return false;
  if (matchPromptFamily(t)) return false;
  if (OPTION_LINE.test(t)) return false;
  if (countOptionLetters(t) >= 3) return false;
  // A trailing lone "?" marker on a label line still carries the label.
  return true;
}

/**
 * Fragments that only make sense as the tail of a wrapped caption. These must
 * never be treated as an answer. A caption tail is built only from
 * function/determiner words and may span several of them ("this area:",
 * "the labeled part", "of the").
 */
const FRAGMENT_WORD =
  /^(?:this|that|the|of|to|in|on|at|is|are|shown|indicated|related|area|region|structure|structures|part|parts|point|points|labeled|labelled|arrow|arrows|here|following|above|below|this\s+area)$/i;

export function isContinuationFragment(text: string): boolean {
  const words = text.trim().replace(/[:;,]+$/, "").split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return words.every((w) => FRAGMENT_WORD.test(w));
}

export type TextLineLike = { text: string; y: number; x: number };

/**
 * Rejoins captions that the PDF wraps across two baselines.
 *
 * Real OSPE diagram pages render e.g.
 *   y=207  "Identify the structure related to this Identify the structure related to"
 *   y=193  "area: this area:"
 * i.e. the caption is both WRAPPED and DOUBLED. Without this pass the tail
 * "area:" is mistaken for a stem and "this area:" is mistaken for an answer.
 */
export function mergeWrappedCaptions<T extends TextLineLike>(lines: T[], opts: { maxGap?: number } = {}): T[] {
  const maxGap = opts.maxGap ?? 40;
  const out: T[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(line);
      continue;
    }
    const gap = prev.y - line.y;
    const prevOpen = !/[?:.!]$/.test(prev.text.trim());
    const cont = isContinuationFragment(line.text) || /^[a-z(]/.test(line.text.trim());
    const sameColumn = Math.abs(prev.x - line.x) <= 150;
    if (prevOpen && cont && gap > 0 && gap <= maxGap && sameColumn) {
      prev.text = `${prev.text} ${line.text}`.replace(/\s+/g, " ").trim();
      continue;
    }
    out.push(line);
  }
  return out;
}

export type PageClassification = {
  class: PageClass;
  reasons: string[];
  questionPromptCount: number;
  optionLetterCount: number;
  hasAnswerLikeLine: boolean;
  labelLikeRatio: number;
};

function labelLike(lines: string[]): number {
  if (lines.length === 0) return 0;
  let labels = 0;
  for (const l of lines) {
    const t = l.trim();
    // Short, capitalised, no sentence punctuation => an anatomical label.
    if (t.length > 0 && t.length <= 42 && /^[A-Z]/.test(t) && !/[.?!]$/.test(t) && !matchPromptFamily(t) && !NUMBERED_STEM.test(t)) {
      labels += 1;
    }
  }
  return labels / lines.length;
}

/**
 * Classifies a page BEFORE any question is extracted, so reference teaching
 * slides are never silently promoted into exam questions.
 */
export function classifyPage(page: PageDoc): PageClassification {
  const reasons: string[] = [];
  const lines = page.lines.map((l) => l.text);
  const joined = page.text;

  let questionPrompts = 0;
  for (const l of lines) {
    if (NUMBERED_STEM.test(l) || matchPromptFamily(l)) questionPrompts += 1;
  }
  const optionLetters = countOptionLetters(joined);
  const hasAnswerLike = lines.some(looksLikeAnswerLine);
  const labelRatio = labelLike(lines);
  const avgFont = page.lines.length
    ? page.lines.reduce((a, l) => a + (l.spans[0]?.fontSize ?? 10), 0) / page.lines.length
    : 0;

  // --- image-only pages: no text to mine at all ---
  if (page.lines.length === 0) {
    if (page.imageOps > 0) {
      reasons.push(`no extractable text; ${page.imageOps} image ops`);
      return { class: "REFERENCE_IMAGE", reasons, questionPromptCount: 0, optionLetterCount: 0, hasAnswerLikeLine: false, labelLikeRatio: 0 };
    }
    reasons.push("blank page");
    return { class: "UNKNOWN", reasons, questionPromptCount: 0, optionLetterCount: 0, hasAnswerLikeLine: false, labelLikeRatio: 0 };
  }

  // --- title / cover ---
  if (page.lines.length <= 4 && avgFont >= 18 && page.imageOps <= 1) {
    reasons.push(`few lines (${page.lines.length}) with large type (${avgFont.toFixed(0)}pt)`);
    return { class: "TITLE", reasons, questionPromptCount: questionPrompts, optionLetterCount: optionLetters, hasAnswerLikeLine: hasAnswerLike, labelLikeRatio: labelRatio };
  }

  // --- question pages ---
  if (questionPrompts > 0) {
    reasons.push(`${questionPrompts} question prompt line(s)`);
    if (optionLetters >= 4) {
      reasons.push(`${optionLetters} MCQ option letters`);
      return { class: "QUESTION_MCQ", reasons, questionPromptCount: questionPrompts, optionLetterCount: optionLetters, hasAnswerLikeLine: hasAnswerLike, labelLikeRatio: labelRatio };
    }
    if (hasAnswerLike) {
      reasons.push("answer-like line follows a prompt");
      return { class: "QUESTION_SHORT_ANSWER", reasons, questionPromptCount: questionPrompts, optionLetterCount: optionLetters, hasAnswerLikeLine: hasAnswerLike, labelLikeRatio: labelRatio };
    }
    reasons.push("prompt without a deterministic answer line");
    return { class: "QUESTION_IMAGE", reasons, questionPromptCount: questionPrompts, optionLetterCount: optionLetters, hasAnswerLikeLine: hasAnswerLike, labelLikeRatio: labelRatio };
  }

  // --- non-question pages ---
  const proseChars = joined.length;
  if (labelRatio >= 0.6 && page.imageOps > 0) {
    reasons.push(`${(labelRatio * 100).toFixed(0)}% label-like lines with ${page.imageOps} image ops and no question prompt`);
    return { class: "REFERENCE_LABELLED_IMAGE", reasons, questionPromptCount: 0, optionLetterCount: optionLetters, hasAnswerLikeLine: hasAnswerLike, labelLikeRatio: labelRatio };
  }
  if (page.imageOps > 0 && proseChars < 400) {
    reasons.push(`image-led page with little text (${proseChars} chars)`);
    return { class: "REFERENCE_IMAGE", reasons, questionPromptCount: 0, optionLetterCount: optionLetters, hasAnswerLikeLine: hasAnswerLike, labelLikeRatio: labelRatio };
  }
  reasons.push(`prose page (${proseChars} chars, labelRatio ${labelRatio.toFixed(2)})`);
  return { class: "THEORY", reasons, questionPromptCount: 0, optionLetterCount: optionLetters, hasAnswerLikeLine: hasAnswerLike, labelLikeRatio: labelRatio };
}

export function isQuestionPage(c: PageClass): boolean {
  return c === "QUESTION_MCQ" || c === "QUESTION_SHORT_ANSWER" || c === "QUESTION_IMAGE" || c === "QUESTION_MIXED";
}
