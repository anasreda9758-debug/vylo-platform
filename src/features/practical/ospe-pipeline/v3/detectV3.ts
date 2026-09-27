import type { PageDoc } from "../v2/pageParse";
import { dedupeRepeatedPhrase } from "../v2/pageParse";
import { matchPromptFamily, isContinuationFragment, looksLikeAnswerLine, type PageClass } from "../v2/classifyPage";
import { detectQuestionNumber } from "./numbering";
import { buildPanelModel, containment, type BBox, type Panel, type PanelModel } from "./geometry";
import { detectPointer, isMarkerGlyph, type PointerMode } from "./pointer";
import { categorise, type Category } from "./distractors";

export type V3Question = {
  id: string;
  sourcePdf: string;
  sourcePage: number;
  panelId: string;
  panelOrientation: string;
  sourceQuestionNumber: number | null;
  stem: string;
  promptKind: string | null;
  questionType: string;
  category: Category;
  answer: string | null;
  answerConfidence: "HIGH" | "MEDIUM" | "LOW";
  answerSource: string;
  pointerMode: PointerMode;
  pointerReason: string;
  imageBBox: BBox | null;
  imageConfidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  questionBBox: BBox;
  studentCropBBox: BBox | null;
  answerLeakRisk: boolean;
  sourceOptions: string[] | null;
  options: string[];
  correctOptionId: string | null;
  needsReview: boolean;
  warnings: string[];
};

/** Vertical distance within which a following line is the answer. */
const ANSWER_GAP = 46;

function bboxOfLine(l: { text: string; x: number; y: number; width: number; height: number }): BBox {
  return { x0: l.x, y0: l.y - l.height, x1: l.x + l.width, y1: l.y };
}

/**
 * Deduplicates caption blocks that the PDF draws twice in nearly the same
 * place. Blocks in DIFFERENT panels are never merged, so genuinely repeated
 * questions on the same page stay separate.
 */
export function dedupeBlocks<T extends { text: string; bbox: BBox }>(blocks: T[], tol = 6): T[] {
  const out: T[] = [];
  for (const b of blocks) {
    const n = normaliseText(b.text);
    const dup = out.find((o) => {
      if (normaliseText(o.text) !== n) return false;
      return (
        Math.abs(o.bbox.x0 - b.bbox.x0) <= tol &&
        Math.abs(o.bbox.y0 - b.bbox.y0) <= tol &&
        Math.abs(o.bbox.x1 - b.bbox.x1) <= tol &&
        Math.abs(o.bbox.y1 - b.bbox.y1) <= tol
      );
    });
    if (!dup) out.push(b);
  }
  return out;
}

function normaliseText(s: string): string {
  return dedupeRepeatedPhrase(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const OPTION_LINE = /^\s*([A-E])\s*[.):]\s*(.+?)\s*$/i;

export type DetectV3Options = {
  fileName: string;
  subject: string | null;
  pageClass: PageClass;
};

export function detectV3(page: PageDoc, opts: DetectV3Options): V3Question[] {
  if (page.lines.length === 0) return [];
  const model: PanelModel = buildPanelModel(page);
  if (model.panels.length === 0) return [];

  const out: V3Question[] = [];
  let seq = 0;

  for (const panel of model.panels) {
    const blocks = dedupeBlocks(panel.blocks);
    if (blocks.length === 0) continue;

    // Flatten this panel's blocks into ordered, de-duplicated lines.
    const panelLines = blocks
      .flatMap((b) => b.lines)
      .sort((a, b) => b.y - a.y)
      .map((l) => ({ line: l, text: normaliseText(l.text) === l.text.toLowerCase() ? l.text : dedupeRepeatedPhrase(l.text) }))
      .filter((p) => p.text.trim().length > 0);

    // Locate the block that carries a question stem.
    for (let i = 0; i < blocks.length; i++) {
      const stemBlock = blocks[i];
      const stemText = dedupeRepeatedPhrase(stemBlock.text).replace(/\s+/g, " ").trim();
      const hit = detectQuestionNumber(stemText);
      const family = matchPromptFamily(stemText);
      if (!hit && !family) continue;

      const stem = hit ? hit.body : stemText;
      if (stem.length < 3) continue;

      const stemBBox = stemBlock.bbox;
      // Anchor the answer search on the stem's OWN line, not the block bottom:
      // a caption and its answer are often merged into one text block, and
      // using the block bottom would hide the answer from the search.
      const stemLine = stemBlock.lines[stemBlock.lines.length - 1];
      const stemLineY = stemLine ? stemLine.y : stemBBox.y1;
      const stemBottom = stemLineY;

      // ---- answer: ONLY from this panel, below the stem, vertically close ----
      const candidates = panelLines
        .map((p) => ({ ...p, bbox: bboxOfLine(p.line) }))
        .filter((p) => p.bbox.y1 <= stemBottom + 2)
        .filter((p) => p.line !== stemLine)
        .filter((p) => stemBottom - p.bbox.y0 <= ANSWER_GAP)
        .filter((p) => containment(p.bbox, panel.bbox) > 0.5)
        .filter((p) => !isContinuationFragment(p.text))
        .filter((p) => !matchPromptFamily(p.text))
        .filter((p) => looksLikeAnswerLine(p.text))
        .filter((p) => !isSelfEchoText(p.text, stem));

      let answer: string | null = null;
      let answerConfidence: V3Question["answerConfidence"] = "LOW";
      let answerSource = "NONE";
      const warnings: string[] = [];

      if (candidates.length === 1) {
        answer = cleanAnswer(candidates[0].text);
        answerConfidence = "HIGH";
        answerSource = "PANEL_SCOPED_SOURCE_TEXT";
      } else if (candidates.length > 1) {
        // Ambiguous: two plausible answers inside the same panel.
        warnings.push(`ambiguous answer: ${candidates.length} candidates in panel`);
        answerConfidence = "LOW";
        answerSource = "AMBIGUOUS";
      } else {
        warnings.push("no answer candidate found inside the question panel");
        answerConfidence = "LOW";
        answerSource = "NONE";
      }

      // ---- source options (MCQ) ----
      const sourceOptions: string[] = [];
      for (const b of blocks.slice(i + 1, i + 8)) {
        const m = OPTION_LINE.exec(b.text.trim());
        if (m) sourceOptions.push(m[2].trim().replace(/[.\s]+$/, ""));
      }
      if (sourceOptions.length && sourceOptions.length !== 5) {
        warnings.push(`source supplied ${sourceOptions.length} option(s), not 5`);
      }

      // ---- image association ----
      const image = panel.images[0] ?? null;
      const imageConfidence: V3Question["imageConfidence"] = image ? "MEDIUM" : "NONE";
      if (!image) warnings.push("no image region associated with this panel");

      // ---- student crop: the panel minus the answer band ----
      let studentCrop: BBox | null = null;
      let leak = false;
      if (image) {
        const answerTop = answer && candidates.length ? Math.min(...candidates.map((c) => c.bbox.y0)) : null;
        if (answerTop != null && answerTop > image.y0) {
          // The answer sits inside the image band: shrink the crop above it
          // when that leaves a usable area, otherwise flag the leak.
          const shrunk: BBox = { ...image, y1: answerTop - 4 };
          const usable = (shrunk.y1 - shrunk.y0) / Math.max(1, image.y1 - image.y0);
          if (usable >= 0.25) {
            studentCrop = shrunk;
          } else {
            leak = true;
            studentCrop = image;
          }
        } else {
          studentCrop = image;
        }
      }

      // ---- pointer ----
      const pointer = detectPointer({
        panelLines: panelLines.map((p) => ({ text: p.text, ...bboxOfLine(p.line) })),
        vectorOps: page.vectorOps,
        hasImage: Boolean(image),
      });

      const questionType = decideType(stem, Boolean(sourceOptions.length >= 3));
      const category = categorise(answer ?? stem);

      out.push({
        id: `${opts.fileName}#${panel.id}#${seq + 1}`,
        sourcePdf: opts.fileName,
        sourcePage: page.page,
        panelId: panel.id,
        panelOrientation: panel.orientation,
        sourceQuestionNumber: hit?.number ?? null,
        stem,
        promptKind: family,
        questionType,
        category,
        answer,
        answerConfidence,
        answerSource,
        pointerMode: pointer.mode,
        pointerReason: pointer.reason,
        imageBBox: image,
        imageConfidence,
        questionBBox: stemBBox,
        studentCropBBox: studentCrop,
        answerLeakRisk: leak,
        sourceOptions: sourceOptions.length ? sourceOptions : null,
        options: [],
        correctOptionId: null,
        needsReview:
          answer === null ||
          answerConfidence === "LOW" ||
          pointer.mode === "MANUAL_REQUIRED" ||
          !image ||
          leak,
        warnings,
      });
      seq += 1;
    }
  }

  return out;
}

function cleanAnswer(s: string): string {
  return s.trim().replace(/\s*[?؟]\s*$/, "").replace(/[.\s]+$/, "").trim();
}

function isSelfEchoText(candidate: string, stem: string): boolean {
  const c = candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const s = stem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!c || !s) return false;
  if (c === s) return true;
  if (c.length >= 8 && s.includes(c)) return true;
  if (s.length >= 8 && c.includes(s)) return true;
  return false;
}

function decideType(stem: string, hasOptions: boolean): string {
  if (hasOptions) return "TEXT_OR_IMAGE_MCQ";
  const family = matchPromptFamily(stem);
  switch (family) {
    case "part": return "IMAGE_IDENTIFY_PART";
    case "lab": return "IMAGE_LAB_IDENTIFICATION";
    case "diagnosis": return "IMAGE_DIAGNOSIS";
    case "surface_anatomy": return "IMAGE_SURFACE_ANATOMY";
    case "relation":
    case "branch_of":
    case "origin": return "IMAGE_RELATED_STRUCTURE";
    case "labelled_structure": return "HISTOLOGY_LABEL";
    case "feature": return "IMAGE_DIAGNOSIS";
    default: return "IMAGE_IDENTIFY_STRUCTURE";
  }
}
