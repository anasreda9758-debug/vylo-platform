/**
 * Pure helpers for the lecture PDF reader.
 *
 * Kept free of React and pdf.js so page maths, fit modes, clamping and search
 * navigation can be unit tested directly.
 */

export type FitMode = "width" | "page" | "custom";

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4;
export const ZOOM_STEP = 0.2;

/** Clamps a scale into the supported range. */
export const clampScale = (scale: number): number => {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 100) / 100));
};

/**
 * Scale that fits the whole page width into the available viewport width,
 * leaving a small gutter so the page never touches the frame edge.
 */
export const fitWidthScale = (
  availableWidth: number,
  pageWidthPt: number,
  gutter = 24,
): number => {
  if (!availableWidth || !pageWidthPt) return 1;
  return clampScale((availableWidth - gutter) / pageWidthPt);
};

/** Scale that fits the entire page (both dimensions) into the viewport. */
export const fitPageScale = (
  availableWidth: number,
  availableHeight: number,
  pageWidthPt: number,
  pageHeightPt: number,
  gutter = 24,
): number => {
  if (!availableWidth || !availableHeight || !pageWidthPt || !pageHeightPt) return 1;
  return clampScale(
    Math.min((availableWidth - gutter) / pageWidthPt, (availableHeight - gutter) / pageHeightPt),
  );
};

/** Constrains a page number to the readable range. */
export const clampPage = (page: number, min: number, max: number): number => {
  const lo = Math.max(1, Math.floor(min || 1));
  const hi = Math.max(lo, Math.floor(max || lo));
  return Math.min(hi, Math.max(lo, Math.floor(page) || lo));
};

/** Resolves the readable range for a lecture, honouring a PDF page slice. */
export const resolveRange = (
  numPages: number,
  pageStart?: number | null,
  pageEnd?: number | null,
): { min: number; max: number; hasRange: boolean } => {
  const total = Math.max(0, Math.floor(numPages || 0));
  const start = pageStart && pageStart > 0 ? Math.floor(pageStart) : 1;
  const hasRange = !!(pageStart && pageEnd && pageEnd >= pageStart);
  if (!total) return { min: start, max: start, hasRange };
  const min = hasRange ? Math.min(start, total) : 1;
  const max = hasRange ? Math.min(Math.floor(pageEnd as number), total) : total;
  return { min: Math.max(1, min), max: Math.max(min, max), hasRange };
};

export type SearchHit = { page: number; index: number; preview: string };

/** Finds every match of a query across per-page text, in page order. */
export const findSearchHits = (pages: Array<{ page: number; text: string }>, query: string): SearchHit[] => {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const { page, text } of pages) {
    if (!text) continue;
    const lower = text.toLowerCase();
    let from = 0;
    let index = 0;
    for (;;) {
      const at = lower.indexOf(q, from);
      if (at < 0) break;
      const start = Math.max(0, at - 30);
      const end = Math.min(text.length, at + q.length + 30);
      hits.push({ page, index: index++, preview: `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}` });
      from = at + q.length;
      if (index > 200) break; // guard against pathological documents
    }
  }
  return hits;
};

/** Wraps to the next/previous hit so search navigation never dead-ends. */
export const stepHit = (hits: SearchHit[], current: number, delta: number): number => {
  if (!hits.length) return 0;
  const next = current + delta;
  if (next < 0) return hits.length - 1;
  if (next >= hits.length) return 0;
  return next;
};

/**
 * Pages whose thumbnails should actually be rendered.
 *
 * Rendering every thumbnail of a 400-page lecture is what makes naive readers
 * unusable, so only a window around the current page is mounted.
 */
export const thumbnailWindow = (page: number, total: number, radius = 3): number[] => {
  if (!total) return [];
  const from = Math.max(1, page - radius);
  const to = Math.min(total, page + radius);
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p);
  return out;
};

/** True when the document has a usable text layer, so search is possible. */
export const hasSearchableText = (totalChars: number): boolean => totalChars > 40;

/** Keyboard shortcut for a key press, or null when it must be ignored. */
export const readerShortcut = (
  key: string,
  inInput: boolean,
): "first" | "prev" | "next" | "last" | "zoomIn" | "zoomOut" | "search" | "thumbnails" | null => {
  if (inInput) return null;
  switch (key) {
    case "Home":
      return "first";
    case "ArrowLeft":
    case "PageUp":
      return "prev";
    case "ArrowRight":
    case "PageDown":
    case " ":
      return "next";
    case "End":
      return "last";
    case "+":
    case "=":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    case "f":
      return "search";
    case "t":
      return "thumbnails";
    default:
      return null;
  }
};
