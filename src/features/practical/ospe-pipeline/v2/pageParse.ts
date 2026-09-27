import { readFile } from "node:fs/promises";
// pdfjs-dist is imported lazily so this module stays importable in a plain
// Node/vitest environment without side effects.
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export type TextSpan = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

export type TextLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  spans: TextSpan[];
};

export type PageDoc = {
  /** 1-based page number inside its source PDF. */
  page: number;
  width: number;
  height: number;
  lines: TextLine[];
  text: string;
  /** Embedded raster images painted on the page. */
  imageOps: number;
  /**
   * Vector path constructions. A page whose question text sits next to a small
   * cluster of paths almost certainly carries SOURCE markers (arrows, leader
   * lines, brackets) rather than plain text.
   */
  vectorOps: number;
  /** Non-black fill/stroke colour changes — coloured annotations. */
  colourOps: number;
  hasSourceMarker: boolean;
};

type PdfjsModule = {
  getDocument: (opts: Record<string, unknown>) => { promise: Promise<PdfDocLike> };
  OPS: Record<string, number>;
};

type PdfDocLike = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageLike>;
  destroy: () => Promise<void>;
};

type PdfPageLike = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: TextItem[] }>;
  getOperatorList: () => Promise<{ fnArray: number[] }>;
  cleanup: () => void;
};

let cached: PdfjsModule | null = null;
async function pdfjs(): Promise<PdfjsModule> {
  if (!cached) {
    cached = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  }
  return cached;
}

/**
 * Groups text items into visual lines by baseline (y), preserving order.
 *
 * A single baseline on a multi-panel slide spans SEVERAL diagram regions (e.g.
 * a question caption at x=44 and an anatomical label at x=500 share y=484). A
 * pure y-merge therefore welds unrelated regions into one bogus sentence, so
 * lines are additionally split whenever the horizontal gap between adjacent
 * spans is large.
 */
function groupLines(items: TextSpan[]): TextLine[] {
  const sorted = [...items].sort((a, b) => (Math.abs(b.y - a.y) > 1.5 ? b.y - a.y : a.x - b.x));
  const lines: TextLine[] = [];
  let cur: TextLine | null = null;

  const flush = () => {
    if (!cur) return;
    cur.text = cur.text.replace(/\s+/g, " ").trim();
    cur.spans.sort((a, b) => a.x - b.x);
    if (cur.text.length > 0) lines.push(cur);
    cur = null;
  };

  for (const it of sorted) {
    if (!cur) {
      cur = { text: it.text, x: it.x, y: it.y, width: it.width, height: it.height, spans: [it] };
      continue;
    }
    const sameBaseline = Math.abs(cur.y - it.y) <= Math.max(2, it.height * 0.5);
    if (!sameBaseline) {
      flush();
      cur = { text: it.text, x: it.x, y: it.y, width: it.width, height: it.height, spans: [it] };
      continue;
    }
    // Same baseline: split when the next span is far to the right of the last.
    const last = cur.spans[cur.spans.length - 1];
    const gap = it.x - (last.x + last.width);
    const charW = Math.max(1, it.height * 0.5);
    if (gap > Math.max(28, charW * 6)) {
      flush();
      cur = { text: it.text, x: it.x, y: it.y, width: it.width, height: it.height, spans: [it] };
      continue;
    }
    cur.spans.push(it);
    cur.text = `${cur.text}${/[\s(\[]$/.test(cur.text) || /^[\s.,;:)\]]/.test(it.text) ? "" : " "}${it.text}`;
    cur.x = Math.min(cur.x, it.x);
    cur.width = Math.max(cur.width, it.x + it.width - cur.x);
    cur.height = Math.max(cur.height, it.height);
  }
  flush();
  return lines;
}

/**
 * Collapses a phrase that the PDF draws twice on the same visual line.
 * Real OSPE slides frequently overlay the caption twice, producing
 * "Identify the structure related to this Identify the structure related to".
 */
export function dedupeRepeatedPhrase(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 6) return text;
  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""));

  // A repeated overlay can be TRUNCATED, so the two runs need not be the same
  // length: find any two positions that share a long enough common prefix and
  // keep the longer run.
  let best: { start: number; offset: number; len: number } | null = null;
  for (let start = 0; start < lower.length; start++) {
    for (let offset = 1; offset < lower.length - start; offset++) {
      let len = 0;
      while (
        start + len < lower.length &&
        start + offset + len < lower.length &&
        lower[start + len] === lower[start + offset + len] &&
        lower[start + len] !== ""
      ) {
        len += 1;
      }
      if (len >= 3 && (!best || len > best.len)) best = { start, offset, len };
    }
  }
  if (!best) return text;

  const aStart = best.start;
  const bStart = best.start + best.offset;
  // Keep the run that extends further. The first run's own extent runs up to
  // where the repeat begins; the second runs to the end of the line.
  const takeA = words.length - aStart >= words.length - bStart;
  const from = takeA ? aStart : bStart;
  const len = takeA ? bStart - aStart : words.length - bStart;
  return words.slice(from, from + len).join(" ");
}

export type ParsedPdf = {
  path: string;
  pageCount: number;
  pages: PageDoc[];
};

export type ParseOptions = {
  /** 1-based inclusive page range. */
  from?: number;
  to?: number;
};

/**
 * Page-aware extraction. Page boundaries come from the PDF page tree — never
 * from blank-line splitting of a flattened text blob.
 */
export async function parsePdfPages(path: string, opts: ParseOptions = {}): Promise<ParsedPdf> {
  const { getDocument, OPS } = await pdfjs();
  const data = new Uint8Array(await readFile(path));
  const doc = await getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;

  const from = Math.max(1, opts.from ?? 1);
  const to = Math.min(doc.numPages, opts.to ?? doc.numPages);
  const pages: PageDoc[] = [];

  for (let n = from; n <= to; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const spans: TextSpan[] = [];
    for (const raw of content.items) {
      if (typeof raw.str !== "string" || raw.str.length === 0) continue;
      const t = raw.transform;
      spans.push({
        text: raw.str,
        x: t[4],
        y: t[5],
        width: raw.width ?? 0,
        height: raw.height ?? (Math.abs(t[3]) || 10),
        fontSize: Math.abs(t[3]) || 10,
      });
    }
    const lines = groupLines(spans);

    const ops = await page.getOperatorList();
    let imageOps = 0;
    let vectorOps = 0;
    let colourOps = 0;
    for (const fn of ops.fnArray) {
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) imageOps++;
      else if (fn === OPS.constructPath) vectorOps++;
      else if (fn === OPS.setFillRGBColor || fn === OPS.setStrokeRGBColor || fn === OPS.setFillCMYKColor || fn === OPS.setStrokeCMYKColor) colourOps++;
    }

    // "Has a source marker" = vector drawing work on a page that also carries
    // question text. Pure prose pages have no such ops.
    const hasSourceMarker = vectorOps >= 2 && lines.length > 0;

    pages.push({
      page: n,
      width: vp.width,
      height: vp.height,
      lines,
      text: lines.map((l) => l.text).join("\n"),
      imageOps,
      vectorOps,
      colourOps,
      hasSourceMarker,
    });
    page.cleanup();
  }

  await doc.destroy();
  return { path, pageCount: doc.numPages, pages };
}

export async function pdfPageCountV2(path: string): Promise<number> {
  const data = new Uint8Array(await readFile(path));
  const { getDocument } = await pdfjs();
  const doc = await getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return n;
}
