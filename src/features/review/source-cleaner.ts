/**
 * Deterministic source cleaning for lecture text.
 *
 * Removes lecture metadata, slide boilerplate, and editorial noise before the
 * content reaches the fact-extraction pipeline. This is a pure, deterministic
 * layer — no AI, no guessing, only pattern matching.
 */

import { normaliseForCompare, similarity } from "./source-analysis";

/**
 * Classification of a source line.
 */
export type LineClass = "CONTENT" | "METADATA" | "HEADER" | "FOOTER" | "NOISE" | "UNKNOWN";

export interface ClassifiedLine {
  raw: string;
  class: LineClass;
  /** Normalised text for dedup/comparison. */
  norm: string;
}

/**
 * Patterns that identify a line as metadata/noise rather than learning content.
 *
 * Ordered by specificity. First match wins.
 */
const NOISE_PATTERNS: Array<{ class: LineClass; re: RegExp }> = [
  // Email addresses
  { class: "NOISE", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },

  // Phone numbers (various formats)
  { class: "NOISE", re: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },

  // Copyright line with year (specific, before generic copyright)
  { class: "FOOTER", re: /(?:©\s*\d{4}|copyright\s+\d{4}|©\s*\d{1,2}[\/.]\d{1,2}\s*\d{4})/i },

  // Standalone "all rights reserved" line
  { class: "NOISE", re: /^\s*all rights reserved\.?\s*$/i },

  // Page numbers (footer)
  { class: "FOOTER", re: /^\s*(?:page|صفحة)\s+\d+/i },

  // Explicit metadata labels
  { class: "METADATA", re: /^\s*(?:prepared by|presented by|delivered by|compiled by|lecturer|instructor|professor|prof\.|dr\.|doctor|assistant professor|associate professor|taught by|supervised by|developed by|author|authored by)\s*:?\s*/i },

  // University / department affiliations (standalone lines)
  { class: "METADATA", re: /^\s*(?:university|college|faculty|department|institute|school|hospital|medical center|clinic)\s+of\s+[A-Z][a-z]+/i },

  // Slide navigation / numbers
  { class: "NOISE", re: /^\s*(?:slide|شريحة|الشريحة)\s*\d+\s*(?:#|number|no\.?|رقم|of|\/)?\s*\d*\s*$/i },

  // Copyright / confidentiality footers
  { class: "FOOTER", re: /^\s*(?:confidential|internal use only|for internal use|do not distribute|draft|version \d+)/i },

  // Lecturer names with titles (when isolated on a line)
  { class: "METADATA", re: /^(?:prof\.|professor|dr\.|doctor|mr\.|ms\.|mrs\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s*$/i },

  // Explicit editorial noise patterns
  { class: "NOISE", re: /(?:LEAVE ME ALONE|leave me alone|DELETE THIS|REMOVE THIS|TODO:|FIXME:|XXX:|PLACEHOLDER)/i },

  // Copyright symbol with text
  { class: "FOOTER", re: /(?:all rights reserved|no part of this|may not be reproduced)/i },

  // Arabic metadata patterns
  { class: "METADATA", re: /^(?:أستاذ|دكتور|بروفيسور|استاذ|مدرس|محاضر)\s+[\u0600-\u06FF\s]{2,}$/ },

  // "Prepared by" Arabic
  { class: "METADATA", re: /(?:إعداد|إشراف|تقديم)\s*:?\s*[\u0600-\u06FF\s]{2,}/ },

  // University names in Arabic (common Egyptian universities)
  { class: "METADATA", re: /(?:جامعة|كلية|معهد)\s+[\u0600-\u06FF\s]{3,}/ },

  // Copyright Arabic
  { class: "FOOTER", re: /(?:جميع الحقوق محفوظة|الحقوق محفوظة|محفوظة|حقوق النشر)/ },
];

/**
 * Patterns that identify a line as a structural header (not content).
 */
const HEADER_PATTERNS: RegExp[] = [
  /^(?:module|موديول|unit|وحدة|lecture|محاضرة|chapter|فصل|week|أسبوع)\s+\d+/i,
  /^(?:lecture|محاضرة)\s+\d+/i,
  /^(?:week|أسبوع)\s+\d+/i,
  /^(?:objectives?|الأهداف|learning outcomes?|المخرجات|overview|ملخص)\s*:?/i,
];

/**
 * Patterns that identify a line as a footer (repeated at bottom of slides).
 */
const FOOTER_PATTERNS: RegExp[] = [
  /^\s*(?:page|صفحة)\s+\d+/i,
  /^\s*\d+\s*\/\s*\d+\s*$/,
];

/**
 * Checks if a line is a structural header.
 */
export const isHeader = (line: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  return HEADER_PATTERNS.some((re) => re.test(t));
};

/**
 * Checks if a line is a structural footer.
 */
export const isFooter = (line: string): boolean => {
  const t = line.trim();
  if (!t) return false;
  return FOOTER_PATTERNS.some((re) => re.test(t));
}

/**
 * Classifies a single line of text.
 */
export const classifyLine = (line: string): LineClass => {
  const t = line.trim();
  if (!t) return "UNKNOWN";

  // Check noise patterns first (most specific)
  for (const { class: cls, re } of NOISE_PATTERNS) {
    if (re.test(t)) return cls;
  }

  // Then structural patterns
  if (isHeader(t)) return "HEADER";
  if (isFooter(t)) return "FOOTER";

  // If it's very short and looks like a label, treat as metadata
  if (t.length < 80 && /^(?:module|موديول|lecture|محاضرة|topic|موضوع|subject|موضوع)\s*:?/i.test(t)) {
    return "METADATA";
  }

  return "UNKNOWN";
};

/**
 * Cleans a single line by removing noise patterns but preserving content.
 */
export const cleanLine = (line: string): string => {
  let t = line;

  // Whole-line noise: editorial commands, slide/page numbers, boilerplate strips
  if (/^\s*(?:LEAVE ME ALONE|DELETE THIS|REMOVE THIS|TODO:|FIXME:|XXX:|PLACEHOLDER)/i.test(t)) return "";
  if (/^\s*(?:slide|شريحة|الشريحة)\s*\d+\s*(?:of\s*\d+|[/]\s*\d+)?\s*$/i.test(t.trim())) return "";
  if (/^\s*\d+\s*\/\s*\d+\s*$/.test(t.trim())) return "";
  const isBoilerplate =
    /(?:©\s*\d{4}|copyright\s+\d{2,4}|all rights reserved|جميع الحقوق محفوظة|الحقوق محفوظة|حقوق النشر)/i.test(t) &&
    t.trim().length <= 90;
  if (isBoilerplate) {
    const remainder = t
      .replace(/(?:©\s*\d{4}|copyright\s+\d{2,4}|all rights reserved|جميع الحقوق محفوظة|الحقوق محفوظة|حقوق النشر)/gi, "")
      .trim();
    // Boilerplate banner: nothing or a single token remains -> drop the whole line
    const tokens = remainder.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
    if (remainder.length === 0 || tokens.length <= 1) return "";
  }

  // Remove year-qualified copyright first (would otherwise be masked below)
  t = t.replace(/©\s*\d{4}/g, "");
  t = t.replace(/copyright\s+\d{2,4}/gi, "");

  // Remove email addresses
  t = t.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "");

  // Remove phone numbers
  t = t.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "");

  // Remove copyright tokens
  t = t.replace(/\b(?:copyright|©|all rights reserved|confidential|proprietary)\b/gi, "");
  t = t.replace(/\b(?:no part of this|may not be reproduced)\b/gi, "");
  t = t.replace(/(?:جميع الحقوق محفوظة|الحقوق محفوظة|محفوظة|حقوق النشر)/gi, "");

  // Remove "prepared by" etc.
  t = t.replace(/^\s*(?:prepared by|presented by|delivered by|compiled by|lecturer|instructor|professor|prof\.|dr\.|doctor|assistant professor|associate professor|taught by|supervised by|developed by|author|authored by)\s*:?\s*/gi, "");
  t = t.replace(/^\s*(?:إعداد|إشراف|تقديم)\s*:?\s*/g, "");

  // Remove explicit noise phrases
  t = t.replace(/(?:LEAVE ME ALONE|leave me alone|DELETE THIS|REMOVE THIS|TODO:|FIXME:|XXX:|PLACEHOLDER)/gi, "");

  // Remove slide / page numbers
  t = t.replace(/^\s*(?:slide|شريحة|الشريحة)\s*\d+\s*(?:of\s*\d+|[/]\s*\d+)?\s*$/gi, "");
  t = t.replace(/^\s*(?:page|صفحة)\s+\d+\s*$/gi, "");

  // Clean up whitespace
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

/**
 * Classifies and cleans all lines in a text block.
 */
export const classifyLines = (text: string): ClassifiedLine[] => {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map((line) => {
    const cls = classifyLine(line);
    const cleaned = cleanLine(line);
    const norm = normaliseForCompare(cleaned);
    return { raw: line, class: cls, norm };
  });
};

/**
 * Filters out noise/metadata/footer lines, keeping only content lines.
 */
export const filterContentLines = (classified: ClassifiedLine[]): ClassifiedLine[] => {
  return classified.filter(
    (cl) => cl.class === "CONTENT" || cl.class === "UNKNOWN"
  );
}

/**
 * Deduplicates lines that are semantically similar.
 * Uses normalised text comparison with Jaccard similarity.
 */
export const deduplicateLines = (lines: ClassifiedLine[], threshold = 0.85): ClassifiedLine[] => {
  const out: ClassifiedLine[] = [];
  for (const line of lines) {
    if (line.class !== "CONTENT" && line.class !== "UNKNOWN") continue;
    if (out.some((kept) => similarity(line.norm, kept.norm) >= Math.max(0.85, threshold))) continue;
    out.push(line);
  }
  return out;
}

/**
 * Full pipeline: raw text -> classified, cleaned, deduplicated content lines.
 */
export const cleanSourceText = (rawText: string): {
  contentLines: ClassifiedLine[];
  metadataLines: ClassifiedLine[];
  noiseLines: ClassifiedLine[];
  stats: { total: number; content: number; metadata: number; noise: number; removed: number };
} => {
  const classified = classifyLines(rawText);

  const metadataLines = classified.filter((cl) => cl.class === "METADATA" || cl.class === "HEADER" || cl.class === "FOOTER");
  const noiseLines = classified.filter((cl) => cl.class === "NOISE");
  const contentLines = classified.filter((cl) => cl.class === "CONTENT" || cl.class === "UNKNOWN");

  const dedupedContent = deduplicateLines(contentLines);

  return {
    contentLines: dedupedContent,
    metadataLines,
    noiseLines,
    stats: {
      total: classified.length,
      content: dedupedContent.length,
      metadata: metadataLines.length,
      noise: noiseLines.length,
      removed: classified.length - dedupedContent.length - metadataLines.length - noiseLines.length,
    },
  };
};

/**
 * Reconstructs cleaned text from classified lines (for downstream consumers).
 */
export const reconstructCleanText = (result: ReturnType<typeof cleanSourceText>): string => {
  return result.contentLines.map((cl) => cl.raw).join("\n");
}

/**
 * Convenience: raw lecture text -> cleaned content text, ready for extraction.
 */
export const cleanedSource = (rawText: string): string => {
  const result = cleanSourceText(rawText ?? "");
  return reconstructCleanText(result).trim();
}

export { normaliseArabic, normaliseForCompare, hasArabic, similarity, deduplicate, tokenise } from "./source-analysis";