/**
 * PDF page geometry for the PDF-first practical pipeline: text spans, question
 * block segmentation, and PDF<->pixel coordinate conversion.
 *
 * NOTE: this module deliberately contains NO rasterization. The in-process
 * @napi-rs/canvas + pdfjs renderer native-crashes Node on large real PDFs, so
 * page rendering lives in pdfRasterizer.ts (Poppler pdftoppm).
 */

import { readFile } from "node:fs/promises";

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;
const loadPdfjs = () => {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
};

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Size = { width: number; height: number };

export type TextSpan = {
  text: string;
  rect: Rect;
  fontSize: number;
};

export type TextLine = {
  text: string;
  rect: Rect;
  fontSize: number;
  spans: TextSpan[];
};

export type PlacedImage = {
  name: string;
  rect: Rect;
  intrinsicWidth: number;
  intrinsicHeight: number;
};

export type PageGeometry = {
  page: number;
  size: Size;
  lines: TextLine[];
  text: string;
  images: PlacedImage[];
  /** Vector path ops — a proxy for source markers (arrows, leaders, brackets). */
  vectorOps: number;
  hasSourceMarker: boolean;
};


/* ------------------------------------------------------------------ */
/* matrices                                                            */
/* ------------------------------------------------------------------ */

/**
 * pdfjs hands matrices over as Float32Array, so Array.isArray is too strict and
 * would silently drop every `cm` operator, leaving an identity CTM.
 */
export const isMatrix = (m: unknown): m is ArrayLike<number> => {
  if (!m || typeof m === "string" || typeof (m as ArrayLike<number>).length !== "number") return false;
  const a = m as ArrayLike<number>;
  if (a.length !== 6) return false;
  for (let i = 0; i < 6; i++) {
    if (typeof a[i] !== "number" || !Number.isFinite(a[i])) return false;
  }
  return true;
};

export const IDENTITY: number[] = [1, 0, 0, 1, 0, 0];

/** Standard column-vector matrix product. A bad result resets to identity. */
export const multiplyMatrix = (m: ArrayLike<number>, n: ArrayLike<number>): number[] => {
  const out = [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + n[4],
    m[1] * n[4] + m[3] * n[5] + n[5],
  ];
  return out.every((v) => Number.isFinite(v)) ? out : IDENTITY.slice();
};

/** Maps the unit square through a CTM, so rotated/skewed placements survive. */
export const unitSquareRect = (ctm: ArrayLike<number>, pageHeight: number): Rect => {
  const pts: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([u, v]) => {
    const x = ctm[0] * u + ctm[2] * v + ctm[4];
    const y = ctm[1] * u + ctm[3] * v + ctm[5];
    return [x, pageHeight - y] as [number, number];
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

/* ------------------------------------------------------------------ */
/* coordinate conversion                                               */
/* ------------------------------------------------------------------ */

/** PDF uses a bottom-left origin; canvas raster uses top-left. */
export const pdfRectToCanvasRect = (rect: Rect, pageHeight: number, scale = 1): Rect => ({
  x0: rect.x0 * scale,
  y0: rect.y0 * scale,
  x1: rect.x1 * scale,
  y1: rect.y1 * scale,
});

export const rectWidth = (r: Rect): number => r.x1 - r.x0;
export const rectHeight = (r: Rect): number => r.y1 - r.y0;
export const rectArea = (r: Rect): number => Math.max(0, rectWidth(r)) * Math.max(0, rectHeight(r));

export const normalizeRect = (r: Rect): Rect => ({
  x0: Math.min(r.x0, r.x1),
  y0: Math.min(r.y0, r.y1),
  x1: Math.max(r.x0, r.x1),
  y1: Math.max(r.y0, r.y1),
});

export const padRect = (r: Rect, pad: number, bounds?: Size): Rect => {
  const n = normalizeRect(r);
  const out: Rect = { x0: n.x0 - pad, y0: n.y0 - pad, x1: n.x1 + pad, y1: n.y1 + pad };
  if (bounds) {
    out.x0 = Math.max(0, out.x0);
    out.y0 = Math.max(0, out.y0);
    out.x1 = Math.min(bounds.width, out.x1);
    out.y1 = Math.min(bounds.height, out.y1);
  }
  return out;
};

export const unionRect = (a: Rect | null, b: Rect): Rect => {
  if (!a) return { ...b };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
};

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

const groupLines = (spans: TextSpan[]): TextLine[] => {
  const sorted = [...spans].sort((a, b) =>
    Math.abs(b.rect.y0 - a.rect.y0) > 1.5 ? b.rect.y0 - a.rect.y0 : a.rect.x0 - b.rect.x0,
  );
  const lines: TextLine[] = [];
  let cur: TextSpan[] = [];
  const flush = () => {
    if (!cur.length) return;
    const spans2 = [...cur].sort((a, b) => a.rect.x0 - b.rect.x0);
    const text = spans2
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      lines.push({
        text,
        rect: {
          x0: Math.min(...spans2.map((s) => s.rect.x0)),
          y0: Math.min(...spans2.map((s) => s.rect.y0)),
          x1: Math.max(...spans2.map((s) => s.rect.x1)),
          y1: Math.max(...spans2.map((s) => s.rect.y1)),
        },
        fontSize: Math.max(...spans2.map((s) => s.fontSize)),
        spans: spans2,
      });
    }
    cur = [];
  };
  for (const s of sorted) {
    const prev = cur[cur.length - 1];
    if (prev && Math.abs(prev.rect.y0 - s.rect.y0) <= Math.max(2, s.fontSize * 0.5)) cur.push(s);
    else {
      flush();
      cur = [s];
    }
  }
  flush();
  return lines;
};

export const openPdf = async (path: string) => {
  const { getDocument } = await loadPdfjs();
  const data = new Uint8Array(await readFile(path));
  return getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
};

export const readPageGeometry = async (doc: never, pageNumber: number): Promise<PageGeometry> => {
  const { OPS } = await loadPdfjs();
  const page = await (doc as unknown as { getPage: (n: number) => Promise<never> }).getPage(pageNumber);
  const vp = (page as unknown as { getViewport: (o: { scale: number }) => Size }).getViewport({ scale: 1 });
  const { height } = vp;

  const images: PlacedImage[] = [];
  let ctm: number[] = IDENTITY.slice();
  const stack: number[][] = [];
  const ops = await (page as unknown as { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }> }).getOperatorList();

  let vectorOps = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = (ops.argsArray[i] ?? []) as unknown[];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() ?? IDENTITY.slice();
    else if (fn === OPS.transform && isMatrix(args[0])) ctm = multiplyMatrix(args[0], ctm);
    else if (fn === OPS.constructPath) vectorOps++;
    else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      // args = [objectName, intrinsicWidth, intrinsicHeight]; the intrinsic size
      // is pixels only. Placement comes from the CTM.
      const rect = unitSquareRect(ctm, height);
      if (rectWidth(rect) > 12 && rectHeight(rect) > 12) {
        images.push({
          name: String(args[0] ?? "inline"),
          rect,
          intrinsicWidth: Number(args[1] ?? 0),
          intrinsicHeight: Number(args[2] ?? 0),
        });
      }
    }
  }

  const content = await (page as unknown as { getTextContent: () => Promise<{ items: unknown[] }> }).getTextContent();
  const spans: TextSpan[] = [];
  for (const raw of content.items as Array<{ str?: string; transform: number[]; width?: number; height?: number }>) {
    if (typeof raw.str !== "string" || !raw.str.trim()) continue;
    const t = raw.transform;
    const fontSize = Math.abs(t[3]) || raw.height || 10;
    const x = t[4];
    const yTop = height - t[5];
    const w = raw.width ?? raw.str.length * fontSize * 0.5;
    spans.push({
      text: raw.str,
      rect: { x0: x, y0: yTop, x1: x + w, y1: yTop + fontSize },
      fontSize,
    });
  }
  const lines = groupLines(spans);

  return {
    page: pageNumber,
    size: { width: vp.width, height: vp.height },
    lines,
    text: lines.map((l) => l.text).join("\n"),
    images,
    vectorOps,
    hasSourceMarker: vectorOps >= 2 && lines.length > 0,
  };
};

