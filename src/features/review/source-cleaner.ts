/**
 * Deterministic source cleaning for lecture text.
 *
 * Everything a student can see — summary, mind map, tutor, flashcards, clinical
 * cases — is derived from lecture text extracted from PDFs. That raw text is
 * full of material that is not study knowledge: bibliography entries, publisher
 * names, department headers, learning-objective wording, footers and slide
 * furniture. This module is the single shared filter that removes it before any
 * generator sees the text.
 *
 * It is pure and deterministic: pattern matching only, no AI, no guessing. The
 * pattern vocabulary lives in `source-signals` so the fact extractor applies the
 * exact same rules without a second, ad-hoc filter.
 */

import { normaliseForCompare, similarity } from "./source-analysis";
import {
  ARABIC_REFERENCE_HEADING_RE,
  CONTENT_HEADING_RE,
  FOOTER_PATTERNS,
  HEADER_PATTERNS,
  ILO_MARKER_RE,
  LABEL_ONLY_RE,
  LIST_PREFIX_RE,
  METADATA_PATTERNS,
  NOISE_PATTERNS,
  OBJECTIVE_LEADIN_RE,
  OBJECTIVE_VERB_RE,
  QUIZ_ITEM_RE,
  REFERENCE_HEADING_RE,
  isMedicalLine,
  isHeadingShaped,
  isTitleLike,
  looksLikeReference,
  referenceSignals,
  stripCitation,
  type ReferenceSignals,
} from "./source-signals";

/**
 * Classification of a source line.
 *
 * - MEDICAL_CONTENT: real study knowledge about the subject.
 * - REFERENCE:        bibliography / citation material (books, editions,
 *                    publishers, cities, page numbers, ISBN/DOI).
 * - METADATA:         ownership and affiliation (department, university,
 *                    faculty, lecturer, contact details).
 * - OBJECTIVE:        administrative learning-objective wording and bare labels.
 * - HEADER:           structural slide/section heading.
 * - FOOTER:           repeated bottom-of-page material.
 * - NOISE:            editorial commands, phone numbers, slide counters.
 * - UNKNOWN:          not recognisable. Kept (never dropped) but ranked below
 *                    MEDICAL_CONTENT so it cannot lead a summary or mind map.
 */
export type LineClass =
  | "MEDICAL_CONTENT"
  | "REFERENCE"
  | "METADATA"
  | "OBJECTIVE"
  | "HEADER"
  | "FOOTER"
  | "NOISE"
  | "UNKNOWN";

/** Classes that may reach a study generator. UNKNOWN is kept but ranked lower. */
export const STUDY_CLASSES: readonly LineClass[] = ["MEDICAL_CONTENT", "UNKNOWN"];

export interface ClassifiedLine {
  raw: string;
  class: LineClass;
  /** Line after noise removal; the value generators receive. */
  cleaned: string;
  /** Normalised text for dedup/comparison. */
  norm: string;
}

export interface CleanOptions {
  /** Lecture title, so repeated title lines can be dropped. */
  title?: string | null;
  /** Module title, so repeated module lines can be dropped. */
  moduleTitle?: string | null;
}

/* ------------------------------------------------------------------ */
/* line cleaning                                                       */
/* ------------------------------------------------------------------ */

/**
 * Removes non-study decoration from a line while keeping its medical text.
 */
export const cleanLine = (line: string): string => {
  let t = line;

  // Whole-line noise
  for (const re of NOISE_PATTERNS) if (re.test(t.trim())) return "";
  if (/^\s*\d+\s*\/\s*\d+\s*$/.test(t.trim())) return "";

  const isBoilerplate =
    /(?:©\s*\d{4}|copyright\s+\d{2,4}|all rights reserved|جميع الحقوق محفوظة|الحقوق محفوظة|حقوق النشر)/i.test(t) &&
    t.trim().length <= 90;
  if (isBoilerplate) {
    const remainder = t
      .replace(/(?:©\s*\d{4}|copyright\s+\d{2,4}|all rights reserved|جميع الحقوق محفوظة|الحقوق محفوظة|حقوق النشر)/gi, "")
      .trim();
    const tokens = remainder.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
    if (remainder.length === 0 || tokens.length <= 1) return "";
  }

  t = t.replace(/©\s*\d{4}/g, "");
  t = t.replace(/copyright\s+\d{2,4}/gi, "");
  t = t.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "");
  t = t.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "");
  t = t.replace(/\b(?:copyright|©|all rights reserved|confidential|proprietary)\b/gi, "");
  t = t.replace(/\b(?:no part of this|may not be reproduced)\b/gi, "");
  t = t.replace(/(?:جميع الحقوق محفوظة|الحقوق محفوظة|محفوظة|حقوق النشر)/gi, "");
  t = t.replace(
    /^\s*(?:prepared by|presented by|delivered by|compiled by|lecturer|instructor|professor|prof\.|dr\.|doctor|assistant professor|associate professor|taught by|supervised by|developed by|author|authored by)\s*:?\s*/gi,
    "",
  );
  t = t.replace(/^\s*(?:إعداد|إشراف|تقديم)\s*:?\s*/g, "");
  t = t.replace(/(?:LEAVE ME ALONE|leave me alone|DELETE THIS|REMOVE THIS|TODO:|FIXME:|XXX:|PLACEHOLDER)/gi, "");
  t = t.replace(/^\s*(?:slide|شريحة|الشريحة)\s*\d+\s*(?:of\s*\d+|[/]\s*\d+)?\s*$/gi, "");
  t = t.replace(/^\s*(?:page|صفحة)\s+\d+\s*$/gi, "");
  t = t.replace(/^\s*[-–—•*▪◦◆■❖➢✓]+\s*/, "");
  t = t.replace(/\s+/g, " ").trim();

  return t;
};

/* ------------------------------------------------------------------ */
/* classification                                                      */
/* ------------------------------------------------------------------ */

/**
 * True when a line must never become study content.
 * Exported so the fact extractor can apply the same filter to sentences.
 */
export const isNonStudyText = (line: string): boolean => {
  const t = line.trim();
  if (!t) return true;
  const cls = classifyLine(t);
  return cls !== "MEDICAL_CONTENT" && cls !== "UNKNOWN";
};

/**
 * Classifies a single line of text.
 *
 * Order matters: a bibliography entry can contain medical words ("Gray's
 * Anatomy for Students"), so references are tested before content.
 */
export const classifyLine = (line: string): LineClass => {
  const t = line.trim();
  if (!t) return "UNKNOWN";

  // Footers are tested on the raw line: "© 2024 University" and "5/50" clean
  // down to nothing, but they are page furniture rather than empty noise.
  for (const re of FOOTER_PATTERNS) if (re.test(t)) return "FOOTER";

  const c = cleanLine(t);
  if (!c) return "NOISE";
  // PDF extraction leaves stray separators ("." , "•", "-----") as their own
  // lines. They are noise, not unknown content.
  if (!/[\p{L}\p{N}]/u.test(c)) return "NOISE";

  // 1. references
  if (REFERENCE_HEADING_RE.test(c) || ARABIC_REFERENCE_HEADING_RE.test(c)) return "REFERENCE";
  if (looksLikeReference(c)) return "REFERENCE";

  // 2. administrative metadata, tested on the raw line because the credit label
  //    ("Prepared by", "إعداد") is removed by cleaning.
  for (const re of METADATA_PATTERNS) if (re.test(t) || re.test(c)) return "METADATA";

  // 3. learning objectives, quiz items and bare labels
  const body = c.replace(LIST_PREFIX_RE, "");
  if (QUIZ_ITEM_RE.test(c)) return "OBJECTIVE";
  if (OBJECTIVE_LEADIN_RE.test(c)) return "OBJECTIVE";
  if (OBJECTIVE_VERB_RE.test(c) || OBJECTIVE_VERB_RE.test(body)) return "OBJECTIVE";
  if (LABEL_ONLY_RE.test(c)) return "OBJECTIVE";
  if (ILO_MARKER_RE.test(c)) return "OBJECTIVE";

  // 4. structural headers
  for (const re of HEADER_PATTERNS) if (re.test(c)) return "HEADER";
  if (t.length < 80 && /^(?:module|موديول|lecture|محاضرة|topic|موضوع|subject|موضوع)\s*:?/i.test(c)) {
    return "METADATA";
  }

  // 5. noise
  for (const re of NOISE_PATTERNS) if (re.test(c)) return "NOISE";

  // 6. a bare section title that names a structure without describing it
  //    ("Valves of the Heart") is a heading, not a fact.
  if (isTitleLike(c)) return "HEADER";

  // 7. study content
  if (isMedicalLine(c)) return "MEDICAL_CONTENT";

  return "UNKNOWN";
};

/**
 * Classifies a whole block, tracking reference sections so every line under a
 * "References" heading stays non-study until a real content section resumes.
 */
/**
 * Rejoins text that a PDF extractor wrapped in the middle of a sentence.
 *
 * Extracted lecture text breaks a statement across several lines, which then
 * makes "Blood" and "pumped from left side of the heart" look like two separate
 * things. A line continues into the next one only when the current line has no
 * terminal punctuation and the next starts mid-sentence (lower case, a bracket
 * or a digit), so a new bullet or a new sentence is never absorbed.
 */
export const rewrapLines = (lines: string[]): string[] => {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const prevOpen = !/[.!?:;،؛؟…]$/.test(prev);
      const cont = /^[a-z(]/.test(t) || /^\d+\s?[.)]?\s*[a-z]/.test(t);
      if (prevOpen && cont) {
        out[out.length - 1] = `${prev} ${t}`.replace(/\s+/g, " ");
        continue;
      }
    }
    out.push(t);
  }
  return out;
};

export const classifyLines = (text: string, opts: CleanOptions = {}): ClassifiedLine[] => {
  const lines = rewrapLines(
    (text ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n"),
  );

  const out: ClassifiedLine[] = [];
  let inReferences = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const cleaned = cleanLine(raw);

    if (REFERENCE_HEADING_RE.test(cleaned) || ARABIC_REFERENCE_HEADING_RE.test(cleaned)) {
      inReferences = true;
      out.push({ raw, class: "REFERENCE", cleaned, norm: normaliseForCompare(cleaned) });
      continue;
    }

    if (inReferences) {
      // Resume content only at a genuine new section: a short heading that is
      // not itself a reference and is followed by medical text.
      const nextClean = cleanLine(lines[i + 1] ?? "");
      const resumes =
        cleaned.length <= 70 &&
        !looksLikeReference(cleaned) &&
        !LABEL_ONLY_RE.test(cleaned) &&
        CONTENT_HEADING_RE.test(cleaned) &&
        nextClean.length > 0 &&
        isMedicalLine(nextClean);
      if (resumes) {
        inReferences = false;
      } else {
        out.push({ raw, class: "REFERENCE", cleaned, norm: normaliseForCompare(cleaned) });
        continue;
      }
    }

    out.push({ raw, class: classifyLine(raw), cleaned, norm: normaliseForCompare(cleaned) });
  }

  return dropRepeatedTitles(out, opts);
};

/** Removes lines that merely repeat the lecture or module title. */
const dropRepeatedTitles = (lines: ClassifiedLine[], opts: CleanOptions): ClassifiedLine[] => {
  const titles = [opts.title, opts.moduleTitle]
    .filter((t): t is string => !!t && t.trim().length > 1)
    .map((t) => normaliseForCompare(t));
  if (!titles.length) return lines;
  return lines.filter((l) => {
    if (!STUDY_CLASSES.includes(l.class)) return true;
    const n = l.norm;
    // Only short, title-like lines are dropped; a real sentence about the topic
    // keeps its content.
    if (!n || n.length > 60) return true;
    return !titles.includes(n);
  });
};

export const isStudyClass = (cls: LineClass): boolean => STUDY_CLASSES.includes(cls);

/** Keeps only the lines a study generator may read. */
export const filterContentLines = (classified: ClassifiedLine[]): ClassifiedLine[] =>
  classified.filter((cl) => isStudyClass(cl.class));

/** Keeps only lines positively identified as medical content. */
export const filterMedicalLines = (classified: ClassifiedLine[]): ClassifiedLine[] =>
  classified.filter((cl) => cl.class === "MEDICAL_CONTENT");

/**
 * Section headings that survived filtering, usable as mind-map categories.
 *
 * A heading is a short, title-like line: no question mark, no trailing full
 * stop, few enough words to be a label rather than a sentence. This keeps
 * "I- Heart" and "II- Blood Vessels" while rejecting numbered statements and
 * multiple-choice questions.
 */
export const filterHeadingLines = (classified: ClassifiedLine[]): string[] => {
  const out: string[] = [];
  for (const cl of classified) {
    if (cl.class !== "HEADER") continue;
    const h = cl.cleaned.replace(/[:.]+$/, "").trim();
    if (h.length < 3 || h.length > 60) continue;
    if (/[?؟]/.test(h)) continue;
    if (/^\d+$/.test(h)) continue;
    if (LABEL_ONLY_RE.test(h)) continue;
    if (looksLikeReference(h)) continue;
    if (/\b(?:following|above|all of|none of)\b/i.test(h)) continue;
    // Strip bullet glyphs and numbering so "❑Arteries" and "2. The blood
    // vessels" read as labels.
    const stripped = h
      .replace(/^[\s•*▪◦◆■❖➢✓❑➜\->–—]+/, "")
      .replace(/^(?:\d+|[IVXLC]{1,4}|[A-Z])[.)\-:–—]\s*/i, "")
      .trim();
    const label = stripped || h;
    if (label.length < 3) continue;
    if (label.split(/\s+/).length > 6) continue;
    if (/[.?!,;]$/.test(label)) continue;
    // A title wrapped across two slide lines ends in a connector.
    if (/(?:&|\band\b|or|of|the|و|من|the)$/i.test(label)) continue;
    out.push(label);
  }
  // Slide titles repeat with inconsistent casing ("Cardiovascular system" /
  // "Cardiovascular System"); keep the first spelling of each distinct title.
  const seen = new Set<string>();
  return out.filter((h) => {
    const key = normaliseForCompare(h);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Deduplicates semantically similar lines, so a slide title repeated on every
 * page does not become several concepts.
 */
export const deduplicateLines = (lines: ClassifiedLine[], threshold = 0.85): ClassifiedLine[] => {
  const out: ClassifiedLine[] = [];
  for (const line of lines) {
    if (!isStudyClass(line.class)) continue;
    if (!line.norm) continue;
    if (out.some((kept) => similarity(line.norm, kept.norm) >= Math.max(0.85, threshold))) continue;
    out.push(line);
  }
  return out;
};

export interface CleanResult {
  /** MEDICAL_CONTENT lines (deduplicated) — the primary study source. */
  medicalLines: ClassifiedLine[];
  /** MEDICAL_CONTENT plus conservatively kept UNKNOWN lines. */
  contentLines: ClassifiedLine[];
  /** Medical section headings, for mind-map hierarchy. */
  headings: string[];
  metadataLines: ClassifiedLine[];
  objectiveLines: ClassifiedLine[];
  referenceLines: ClassifiedLine[];
  headerLines: ClassifiedLine[];
  footerLines: ClassifiedLine[];
  noiseLines: ClassifiedLine[];
  unknownLines: ClassifiedLine[];
  stats: {
    total: number;
    medical: number;
    content: number;
    metadata: number;
    objective: number;
    reference: number;
    header: number;
    footer: number;
    noise: number;
    unknown: number;
    removed: number;
  };
}

/** Full pipeline: raw text -> classified, cleaned, deduplicated study lines. */
export const cleanSourceText = (rawText: string, opts: CleanOptions = {}): CleanResult => {
  const classified = classifyLines(rawText, opts);

  const pick = (cls: LineClass) => classified.filter((cl) => cl.class === cls);
  const medicalLines = pick("MEDICAL_CONTENT");
  const unknownLines = pick("UNKNOWN");
  const contentLines = deduplicateLines([...medicalLines, ...unknownLines]);

  return {
    medicalLines: deduplicateLines(medicalLines),
    contentLines,
    headings: filterHeadingLines(classified),
    metadataLines: pick("METADATA"),
    objectiveLines: pick("OBJECTIVE"),
    referenceLines: pick("REFERENCE"),
    headerLines: pick("HEADER"),
    footerLines: pick("FOOTER"),
    noiseLines: pick("NOISE"),
    unknownLines,
    stats: {
      total: classified.length,
      medical: medicalLines.length,
      content: contentLines.length,
      metadata: pick("METADATA").length,
      objective: pick("OBJECTIVE").length,
      reference: pick("REFERENCE").length,
      header: pick("HEADER").length,
      footer: pick("FOOTER").length,
      noise: pick("NOISE").length,
      unknown: unknownLines.length,
      removed: classified.length - contentLines.length,
    },
  };
};

/** Joins the values of a line list into plain text. */
export const linesToText = (lines: ClassifiedLine[]): string =>
  lines.map((cl) => cl.cleaned).filter(Boolean).join("\n");

/** Backwards-compatible alias: medical content plus kept UNKNOWN lines. */
export const reconstructCleanText = (result: CleanResult): string => linesToText(result.contentLines);

/**
 * Convenience: raw lecture text -> cleaned study text.
 *
 * MEDICAL_CONTENT is preferred. UNKNOWN lines are used only when a lecture
 * yields no positively identified medical line, so a real lecture is never
 * emptied by a conservative filter.
 */
export const cleanedSource = (rawText: string, opts: CleanOptions = {}): string => {
  const result = cleanSourceText(rawText ?? "", opts);
  if (result.medicalLines.length) return linesToText(result.medicalLines).trim();
  // No positively identified medical line: fall back to UNKNOWN, but never to a
  // stray heading ("Valves of the Heart") or a reference heading.
  const usable = result.unknownLines.filter((cl) => !isHeadingShaped(cl.cleaned));
  return linesToText(usable).trim();
};

export { looksLikeReference, stripCitation, isMedicalLine, isHeadingShaped, isTitleLike, referenceSignals, type ReferenceSignals };
export { normaliseArabic, normaliseForCompare, hasArabic, similarity, deduplicate, tokenise } from "./source-analysis";
