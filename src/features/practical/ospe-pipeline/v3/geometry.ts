import type { PageDoc, TextLine } from "../v2/pageParse";

export type BBox = { x0: number; y0: number; x1: number; y1: number };

export type TextBlock = {
  bbox: BBox;
  text: string;
  fontSize: number;
  lines: TextLine[];
  /** Left edge of the block, used to group vertically-adjacent lines. */
  left: number;
  /** Bottom edge, used to detect row breaks. */
  bottom: number;
};
export type ImageBlock = BBox;
export type DrawingBlock = BBox;

export type Panel = {
  id: string;
  page: number;
  /** Panel bounds. */
  bbox: BBox;
  /** Text blocks spatially inside this panel. */
  blocks: TextBlock[];
  /** Image blocks overlapping this panel. */
  images: ImageBlock[];
  /** Index of this panel on the page (left-to-right, top-to-bottom). */
  order: number;
  orientation: "LEFT" | "RIGHT" | "TOP" | "BOTTOM" | "FULL";
};

function bboxOf(l: TextLine): BBox {
  return { x0: l.x, y0: l.y - l.height, x1: l.x + l.width, y1: l.y };
}

function union(a: BBox, b: BBox): BBox {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function overlapArea(a: BBox, b: BBox): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function area(b: BBox): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

/** Vertical gap below `from` at which a new panel row begins. */
const ROW_GAP_RATIO = 0.06;
/** Horizontal gap that separates a left panel from a right panel. */
const COL_GAP_RATIO = 0.05;

export type PanelModel = {
  page: number;
  width: number;
  height: number;
  blocks: TextBlock[];
  images: ImageBlock[];
  panels: Panel[];
};

/**
 * Groups text lines into blocks: consecutive lines that are horizontally
 * aligned (similar x) and vertically close belong to the same block.
 */
export function buildTextBlocks(page: PageDoc): TextBlock[] {
  const lines = [...page.lines].sort((a, b) => b.y - a.y);
  const blocks: TextBlock[] = [];
  for (const l of lines) {
    const b = bboxOf(l);
    const last = blocks[blocks.length - 1];
    if (last) {
      const sameColumn = Math.abs(last.left - b.x0) <= 40;
      const close = last.bottom - b.y0 >= -4 && last.bottom - b.y0 <= 46;
      if (sameColumn && close) {
        last.bbox = union(last.bbox, b);
        last.text = `${last.text} ${l.text}`.replace(/\s+/g, " ").trim();
        last.lines.push(l);
        last.bottom = Math.max(last.bottom, b.y1);
        continue;
      }
    }
    blocks.push({ bbox: b, left: b.x0, bottom: b.y1, text: l.text, fontSize: l.spans[0]?.fontSize ?? 10, lines: [l] });
  }
  return blocks;
}

/**
 * Segments a page into spatially independent PANELS.
 *
 * The corpus is dominated by multi-panel slides (two labelled diagrams side by
 * side, or stacked). A global x/y sort of all text welds neighbouring panels
 * together and lets panel A's answer answer panel B's question, so panels are
 * found by clustering on large horizontal / vertical gaps first.
 */
export function segmentPanels(page: PageDoc, blocks: TextBlock[]): Panel[] {
  if (blocks.length === 0) return [];
  const rowGap = page.height * ROW_GAP_RATIO;
  const colGap = page.width * COL_GAP_RATIO;

  // Standalone marker glyphs ("?", "(3)", "b") are ANNOTATIONS, not content.
  // They are excluded from row/column grouping because on these slides a "?"
  // frequently sits physically BETWEEN a question and its own answer, which
  // would otherwise split the pair into two panels and lose the answer.
  const markerGlyph = (t: string) => /^\s*[?؟]\s*$/.test(t) || /^\s*(?:\(\s*\d{1,2}\s*\)|\d{1,2}\s*[.)]?|[a-eA-E])\s*$/.test(t);
  const contentBlocks = blocks.filter((b) => !markerGlyph(b.text));

  // --- rows: split where the vertical gap is large ---
  // `lastBottom` MUST reset with each new row: leaving it pinned to the first
  // block on the page made every subsequent block start its own row, which
  // split each question away from its own answer.
  const rows: TextBlock[][] = [];
  let cur: TextBlock[] = [];
  let lastBottom = -Infinity;
  for (const b of contentBlocks) {
    // Compare BASELINES (`bottom` is the baseline; `bbox.y0` sits a line-height
    // lower and inflated the gap so closely-spaced Q/A pairs were split).
    if (cur.length && lastBottom - b.bottom > rowGap) {
      rows.push(cur);
      cur = [];
      lastBottom = -Infinity;
    }
    cur.push(b);
    lastBottom = Math.max(lastBottom, b.bbox.y1);
  }
  if (cur.length) rows.push(cur);

  const panels: Panel[] = [];
  for (const row of rows) {
    // --- columns: split where the horizontal gap is large ---
    const sorted = [...row].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const cols: TextBlock[][] = [];
    let cc: TextBlock[] = [];
    let lastRight = -Infinity;
    for (const b of sorted) {
      if (cc.length && b.bbox.x0 - lastRight > colGap) {
        cols.push(cc);
        cc = [];
        lastRight = -Infinity;
      }
      cc.push(b);
      lastRight = Math.max(lastRight, b.bbox.x1);
    }
    if (cc.length) cols.push(cc);

    for (const col of cols) {
      const bbox = col.reduce((acc, b) => union(acc, b.bbox), col[0].bbox);
      panels.push({
        id: `p${page.page}#${panels.length}`,
        page: page.page,
        bbox,
        blocks: col,
        images: [],
        order: panels.length,
        orientation: "FULL",
      });
    }
  }

  // Assign orientation labels for the common two-panel layouts.
  if (panels.length === 2) {
    const [a, b] = panels;
    const sameRow = Math.abs(a.bbox.y0 - b.bbox.y0) < page.height * 0.25;
    if (sameRow) {
      a.orientation = a.bbox.x0 < b.bbox.x0 ? "LEFT" : "RIGHT";
      b.orientation = a.bbox.x0 < b.bbox.x0 ? "RIGHT" : "LEFT";
    } else {
      a.orientation = a.bbox.y0 > b.bbox.y0 ? "BOTTOM" : "TOP";
      b.orientation = a.bbox.y0 > b.bbox.y0 ? "TOP" : "BOTTOM";
    }
  }

  // Attach image blocks that overlap each panel, preferring the panel with the
  // larger overlap fraction so an image spanning both panels is still claimed.
  const imageBlocks = estimateImageBlocks(page);
  for (const img of imageBlocks) {
    let best: Panel | null = null;
    let bestFrac = 0;
    for (const panel of panels) {
      const ov = overlapArea(img, panel.bbox);
      if (ov <= 0) continue;
      const frac = ov / Math.max(1, area(panel.bbox));
      if (frac > bestFrac) {
        bestFrac = frac;
        best = panel;
      }
    }
    if (best && bestFrac >= 0.08) best.images.push(img);
  }

  // Re-attach the excluded marker glyphs to the nearest panel so pointer
  // detection still sees them, without letting them fragment the layout.
  for (const b of blocks) {
    if (!markerGlyph(b.text)) continue;
    let best: Panel | null = null;
    let bestD = Infinity;
    for (const panel of panels) {
      const dx = Math.max(0, Math.max(panel.bbox.x0 - b.bbox.x1, b.bbox.x0 - panel.bbox.x1));
      const dy = Math.max(0, Math.max(panel.bbox.y0 - b.bbox.y1, b.bbox.y0 - panel.bbox.y1));
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = panel;
      }
    }
    if (best) best.blocks.push(b);
  }

  return panels;
}

/**
 * Estimates raster-image regions from the page's own images. pdfjs exposes the
 * painted image ops but not their geometry through the high-level API, so the
 * image band is approximated as the full content area minus the text margins —
 * good enough to anchor crops and to detect the image-only lane.
 */
export function estimateImageBlocks(page: PageDoc): ImageBlock[] {
  if (page.imageOps === 0) return [];
  const mx = page.width * 0.04;
  const my = page.height * 0.04;
  return [{ x0: mx, y0: my, x1: page.width - mx, y1: page.height - my }];
}

export function buildPanelModel(page: PageDoc): PanelModel {
  const blocks = buildTextBlocks(page);
  const panels = segmentPanels(page, blocks);
  return { page: page.page, width: page.width, height: page.height, blocks, images: estimateImageBlocks(page), panels };
}

/** Fraction of `inner` that lies inside `outer`. */
export function containment(inner: BBox, outer: BBox): number {
  const a = area(inner);
  if (a <= 0) return 0;
  return overlapArea(inner, outer) / a;
}
