/**
 * Question-block segmentation for the PDF-first practical pipeline.
 *
 * A question block runs from its own numbered header down to the header of the
 * NEXT question, so blocks are derived from text geometry rather than from
 * internal PDF image objects. This is fallback level 3 and works for text PDFs,
 * scanned PDFs and Form-XObject-heavy decks alike.
 */

import { rectHeight, rectWidth, unionRect, type PageGeometry, type Rect, type TextLine } from "./pdfGeometry";

export type QuestionType =
  | "IMAGE_MCQ"
  | "MULTI_IMAGE_MCQ"
  | "IMAGE_IDENTIFICATION"
  | "IMAGE_DIAGNOSIS"
  | "ANATOMY_SPOTTER"
  | "HISTOLOGY_IMAGE"
  | "MICROBIOLOGY_IMAGE"
  | "DEVICE_IMAGE"
  | "PROCEDURE_IMAGE";

export type ExtractionStrategy = "IMAGE_OBJECT" | "FORM_XOBJECT" | "RASTER_BLOCK";

export type QuestionOption = { label: string; text: string };

export type QuestionBlock = {
  questionNumber: number | null;
  page: number;
  /** Block region: header through the line above the next header. */
  rect: Rect;
  stem: string;
  /** Stem is printed verbatim from the PDF; no rewriting. */
  options: QuestionOption[];
  /** Answer text found in the source PDF itself, if present. */
  printedAnswer: string | null;
  questionType: QuestionType;
  strategy: ExtractionStrategy;
  /** Image regions inside the block. */
  imageRects: Rect[];
  hasSourceMarker: boolean;
  confidence: number;
  notes: string[];
};

/** Matches a leading question number: "1)", "12)", "Q7.", "7 -" */
const HEADER_RE = /^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*[\)\.\-:]\s*(.*)$/i;

/** Option lines: "A. text", "a) text", "(A) text" */
const OPTION_RE = /^\s*\(?([A-Ea-e])[\)\.\-]\s*(.+)$/;

/** Bare numbers and ticks are image labels, never answers. */
const LABEL_ONLY_RE = /^[\s\d\.\*\+\-–—:;,]+$/;

/**
 * Recovers the answer a revision deck prints under the question.
 *
 * The answer is NOT reliably punctuated — real CVS pages print "Superior vena
 * cava", "Ascending aorta" and "Pulmonary artery ?" with no full stop — so it
 * cannot be matched on a trailing period. Instead the answer is the last
 * prose line of the block that is not a header, option, or bare image label.
 */
export const extractPrintedAnswer = (bodyLines: TextLine[], headerText: string): string | null => {
  const candidates = bodyLines.filter(
    (l) =>
      !HEADER_RE.test(l.text) &&
      !OPTION_RE.test(l.text) &&
      !isMarkerGlyph(l.text) &&
      !LABEL_ONLY_RE.test(l.text) &&
      l.text.trim() !== headerText.trim(),
  );
  const last = candidates[candidates.length - 1];
  if (!last) return null;
  // Strip a trailing "?" that belongs to the source marker, and terminal punctuation.
  const text = last.text.replace(/\s*\?\s*$/, "").replace(/[.\s]+$/, "").trim();
  if (text.length < 2 || text.length > 120) return null;
  return text;
};

export const parseQuestionHeader = (line: TextLine): { number: number | null; stem: string } | null => {
  const m = HEADER_RE.exec(line.text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 999) return null;
  return { number: n, stem: m[2].trim() };
};

/**
 * Standalone source markers ("?", arrows, bullets) that sit ON the medical
 * visual. They are legitimate source evidence and must stay in page geometry,
 * but they are not prose: counting them as prose pushes the text column edge
 * far to the right and collapses the student crop to a useless sliver.
 */
const MARKER_ONLY_RE = /^[?→←↑↓⇐⇒•·▪◦*+\-–—]+$/u;

export const isMarkerGlyph = (text: string): boolean => MARKER_ONLY_RE.test(text.trim());

export const isProseLine = (line: TextLine): boolean => !isMarkerGlyph(line.text);

/** Horizontal extent of real prose only, ignoring marker glyphs. */
export const proseExtent = (lines: TextLine[]): { left: number; right: number } | null => {
  const prose = lines.filter(isProseLine);
  if (!prose.length) return null;
  return {
    left: Math.min(...prose.map((l) => l.rect.x0)),
    right: Math.max(...prose.map((l) => l.rect.x1)),
  };
};

export const classifyQuestionType = (stem: string, opts: QuestionOption[], marker: boolean): QuestionType => {
  const s = stem.toLowerCase();
  if (marker && /identify|what is|which/.test(s)) return "ANATOMY_SPOTTER";
  if (/diagnos|represents|condition|lesion|patholog/.test(s)) return "IMAGE_DIAGNOSIS";
  if (/histolog|slide|section|stain|tissue/.test(s)) return "HISTOLOGY_IMAGE";
  if (/organism|culture|gram|stain|medium|antibiotic|sensitiv/.test(s)) return "MICROBIOLOGY_IMAGE";
  if (opts.length > 1) return "IMAGE_MCQ";
  return "IMAGE_IDENTIFICATION";
};

/**
 * Segments a page into question blocks. Blocks are cut at numbered headers, so
 * a block can never absorb the next question's header.
 */
export const segmentQuestionBlocks = (page: PageGeometry): QuestionBlock[] => {
  const lines = [...page.lines].sort((a, b) => a.rect.y0 - b.rect.y0);
  const headers: Array<{ index: number; number: number; stem: string }> = [];
  lines.forEach((l, i) => {
    const h = parseQuestionHeader(l);
    if (h && h.number !== null) headers.push({ index: i, number: h.number, stem: h.stem });
  });
  if (!headers.length) return [];

  const pageTop = 0;
  const pageBottom = page.size.height;

  const blocks: QuestionBlock[] = [];
  for (let hi = 0; hi < headers.length; hi++) {
    const h = headers[hi];
    const next = headers[hi + 1];
    const startY = lines[h.index].rect.y0;
    // Hard boundary at the next header, so no contamination is possible.
    const endY = next ? lines[next.index].rect.y0 : pageBottom;
    const bodyLines = lines.filter((l) => l.rect.y0 >= startY && l.rect.y0 < endY);

    const stem = h.stem;
    const options: QuestionOption[] = [];
    for (const l of bodyLines) {
      const om = OPTION_RE.exec(l.text);
      if (om && om[1].toUpperCase() === String.fromCharCode(65 + options.length)) {
        options.push({ label: om[1].toUpperCase(), text: om[2].trim() });
      }
    }
    // Only short-answer blocks print their answer. A source MCQ must never have
    // one of its own options mistaken for a printed answer.
    const printedAnswer = options.length >= 2 ? null : extractPrintedAnswer(bodyLines, lines[h.index].text);

    const blockRect: Rect = {
      x0: 0,
      y0: next ? startY : Math.max(pageTop, startY),
      x1: page.size.width,
      y1: next ? endY : pageBottom,
    };
    // Keep only real content extents horizontally, but never above the header.
    let contentRect: Rect | null = null;
    for (const l of bodyLines) contentRect = unionRect(contentRect, l.rect);
    for (const im of page.images) {
      if (im.rect.y0 >= blockRect.y0 - 1 && im.rect.y1 <= blockRect.y1 + 1) {
        contentRect = unionRect(contentRect, im.rect);
      }
    }
    const rect = contentRect ? unionRect({ ...blockRect, x1: contentRect.x1 }, contentRect) : blockRect;
    rect.x0 = 0;
    rect.x1 = page.size.width;

    const strategy: ExtractionStrategy = page.images.length ? "IMAGE_OBJECT" : "RASTER_BLOCK";
    const inBlock = page.images.filter(
      (im) => im.rect.y0 >= rect.y0 - 1 && im.rect.y1 <= rect.y1 + 1 && rectHeight(im.rect) > 12 && rectWidth(im.rect) > 12,
    );

    const hasSourceMarker = page.hasSourceMarker && /identify|what is|which|branch from/.test(stem.toLowerCase());
    const notes: string[] = [];
    if (!inBlock.length) notes.push("no placed image bbox in block; using raster block crop (level 3)");
    if (options.length === 0) notes.push("no MCQ options in source; short-answer format");
    if (printedAnswer) notes.push("answer text printed in source PDF");
    if (hasSourceMarker) notes.push("source marker detected; preserved, no arrow added");

    blocks.push({
      questionNumber: h.number,
      page: page.page,
      rect,
      stem,
      options,
      printedAnswer,
      questionType: classifyQuestionType(stem, options, hasSourceMarker),
      strategy,
      imageRects: inBlock.map((im) => im.rect),
      hasSourceMarker,
      confidence: Math.min(1, 0.5 + (inBlock.length ? 0.2 : 0) + (printedAnswer ? 0.2 : 0) + (stem ? 0.1 : 0)),
      notes,
    });
  }
  return blocks;
};

/**
 * Re-runs block segmentation using raster whitespace separators.
 *
 * The text-only version in `segmentQuestionBlocks` must cut at the next
 * question's header, which leaks the next question's image because that image
 * sits ABOVE its own header. This variant takes explicit separator Y values
 * (derived from the rendered raster) and refuses to place a boundary at or
 * below the next header.
 */
export const applySeparators = (
  page: PageGeometry,
  blocks: QuestionBlock[],
  separators: Array<{ separatorY: number; confidence: number; reason: string } | null>,
  tops: Array<{ separatorY: number; confidence: number; reason: string } | null> = [],
): QuestionBlock[] => {
  const lines = [...page.lines].sort((a, b) => a.rect.y0 - b.rect.y0);
  const headers = blocks.map((b) => {
    const line = lines.find((l) => parseQuestionHeader(l)?.number === b.questionNumber);
    return line?.rect.y0 ?? b.rect.y0;
  });

  return blocks.map((b, i) => {
    const startY = headers[i];
    const next = blocks[i + 1];
    const nextY = next ? headers[i + 1] : page.size.height;
    const sep = separators[i];
    const top = tops[i];

    // A question's own visual can start ABOVE its caption, so the block is
    // extended up to the nearest blank band; without this the image is clipped.
    let topY = startY;
    if (top && top.separatorY > 0 && top.separatorY < startY - 4) topY = top.separatorY;

    let endY: number;
    const notes = [...b.notes];
    if (!next) {
      endY = page.size.height;
    } else if (sep && sep.separatorY > topY + 4 && sep.separatorY < nextY) {
      endY = sep.separatorY;
      notes.push(`block ends at raster whitespace separator (${sep.reason}, confidence ${sep.confidence.toFixed(2)})`);
    } else {
      // Fail safe rather than contaminate: stop short of the next header.
      endY = nextY - 1;
      notes.push("WARNING: no usable separator; boundary placed just above next header");
    }

    const bodyLines = lines.filter((l) => l.rect.y0 >= topY && l.rect.y0 < endY);
    let contentRect: Rect | null = null;
    for (const l of bodyLines) contentRect = unionRect(contentRect, l.rect);
    for (const im of page.images) {
      if (im.rect.y0 >= topY - 1 && im.rect.y1 <= endY + 1) contentRect = unionRect(contentRect, im.rect);
    }
    const rect: Rect = contentRect
      ? { x0: 0, y0: Math.min(topY, contentRect.y0), x1: page.size.width, y1: Math.max(endY, contentRect.y1) }
      : { x0: 0, y0: topY, x1: page.size.width, y1: endY };
    rect.y0 = Math.min(rect.y0, topY);
    rect.y1 = Math.min(rect.y1, next ? nextY : page.size.height);

    return { ...b, rect, notes, confidence: sep && next ? Math.min(1, b.confidence * 0.5 + sep.confidence * 0.5) : b.confidence };
  });
};
export const rasterImageRegions = (block: QuestionBlock, page: PageGeometry, minGap = 24): Rect[] => {
  const lines = page.lines
    .filter((l) => l.rect.y0 >= block.rect.y0 - 1 && l.rect.y1 <= block.rect.y1 + 1)
    .sort((a, b) => a.rect.y0 - b.rect.y0);
  if (lines.length < 2) return [];
  const regions: Rect[] = [];
  for (let i = 1; i < lines.length; i++) {
    const top = lines[i - 1].rect.y1;
    const bottom = lines[i].rect.y0;
    if (bottom - top >= minGap) regions.push({ x0: 0, y0: top, x1: page.size.width, y1: bottom });
  }
  return regions;
};

export type StudentVisual = {
  rect: Rect;
  /** How the region was chosen, for auditability. */
  strategy: "RIGHT_OF_TEXT_COLUMN" | "TEXT_FREE_GAP";
  /** True when the crop provably excludes every text span in the block. */
  textFree: boolean;
  notes: string[];
};

/**
 * Derives the crop a STUDENT should see: the medical visual only, never the
 * stem/answer/option text.
 *
 * Uses the PROSE text column (marker glyphs excluded) because revision decks
 * place the "?" / leader arrow on the visual itself; treating it as prose
 * collapses this crop to a sliver.
 */
export const studentVisualRect = (block: QuestionBlock, page: PageGeometry): StudentVisual | null => {
  const blockLines = page.lines.filter((l) => l.rect.y0 >= block.rect.y0 - 1 && l.rect.y1 <= block.rect.y1 + 1);
  if (!blockLines.length) return null;
  const notes: string[] = [];
  const prose = proseExtent(blockLines);

  // Layout 1 (CVS anatomy): prose column on the left, medical visual to its right.
  if (prose) {
    const remaining = page.size.width - prose.right;
    if (remaining > page.size.width * 0.2) {
      const rect: Rect = { x0: prose.right + 2, y0: block.rect.y0, x1: page.size.width, y1: block.rect.y1 };
      const overlapsProse = blockLines.filter(isProseLine).some((l) => l.rect.x1 > prose.right + 1);
      if (overlapsProse) notes.push("WARNING: prose may fall inside the student crop");
      notes.push("crop starts right of the prose column, so the printed answer is not shipped to students");
      return { rect, strategy: "RIGHT_OF_TEXT_COLUMN", textFree: !overlapsProse, notes };
    }
  }

  // Layout 2: prose spans the width, so the visual sits in a vertical text-free
  // gap between prose bands.
  const proseLines = blockLines.filter(isProseLine).sort((a, b) => a.rect.y0 - b.rect.y0);
  if (proseLines.length >= 2) {
    const gaps: Rect[] = [];
    for (let i = 1; i < proseLines.length; i++) {
      const top = proseLines[i - 1].rect.y1;
      const bottom = proseLines[i].rect.y0;
      if (bottom - top >= 24) gaps.push({ x0: 0, y0: top, x1: page.size.width, y1: bottom });
    }
    const best = gaps.sort((a, b) => b.y1 - b.y0 - (a.y1 - a.y0))[0];
    if (best) {
      notes.push("crop is the largest prose-free vertical band inside the block");
      return { rect: best, strategy: "TEXT_FREE_GAP", textFree: true, notes };
    }
  }
  notes.push("no prose-free region found; block crop required for manual review");
  return null;
};

/* ------------------------------------------------------------------ */
/* safety gates                                                        */
/* ------------------------------------------------------------------ */

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export const NEXT_QUESTION_CONTAMINATION = "NEXT_QUESTION_CONTAMINATION";
export const ANSWER_LEAK = "ANSWER_LEAK";

export type SafetyReport = {
  contaminated: boolean;
  answerLeak: boolean;
  warnings: string[];
};

/**
 * A crop is unsafe if it overlaps the NEXT question's content (its header, its
 * marker, its prose) or the printed answer.
 *
 * Note this must be measured against the NEXT BLOCK specifically. A block's own
 * source "?" marker legitimately sits inside its rect on the medical visual, so
 * treating "any text inside the block" as foreign would fail every question.
 */
export const checkCropSafety = (
  crop: Rect,
  page: PageGeometry,
  block: QuestionBlock,
  nextBlock: QuestionBlock | null,
  isAnswerText: (line: TextLine) => boolean,
): SafetyReport => {
  const warnings: string[] = [];
  let contaminated = false;
  let answerLeak = false;

  const nextLines = nextBlock
    ? page.lines.filter((l) => l.rect.y0 >= nextBlock.rect.y0 - 2 && l.rect.y1 <= nextBlock.rect.y1 + 2)
    : [];

  for (const l of nextLines) {
    if (rectsOverlap(crop, l.rect)) {
      contaminated = true;
      warnings.push(`${NEXT_QUESTION_CONTAMINATION}: crop overlaps next question's "${l.text.slice(0, 40)}"`);
      break;
    }
  }

  // A crop that reaches past its own block boundary has escaped its region.
  if (!contaminated && (crop.y1 > block.rect.y1 + 2 || crop.y0 < block.rect.y0 - 2)) {
    contaminated = true;
    warnings.push(`${NEXT_QUESTION_CONTAMINATION}: crop escapes its question block bounds`);
  }

  for (const l of page.lines) {
    if (!isAnswerText(l)) continue;
    if (rectsOverlap(crop, l.rect)) {
      answerLeak = true;
      warnings.push(`${ANSWER_LEAK}: crop overlaps printed answer "${l.text.slice(0, 40)}"`);
      break;
    }
  }

  return { contaminated, answerLeak, warnings };
};
