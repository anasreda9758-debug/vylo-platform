import { describe, expect, it } from "vitest";
import {
  PDF_RASTERIZER_NOT_AVAILABLE, discoverRasterizer, findRasterizer, pdfPointsToPixels,
  readPngSize, renderPdfPage, findQuestionSeparatorY, findQuestionTopY, type RowProfile,
} from "./pdfRasterizer";
import {
  isMarkerGlyph, isProseLine, proseExtent, rectsOverlap, studentVisualRect,
  checkCropSafety, ANSWER_LEAK, NEXT_QUESTION_CONTAMINATION, segmentQuestionBlocks,
  applySeparators,
} from "./questionBlock";
import { isMatrix, multiplyMatrix, unitSquareRect, IDENTITY, padRect } from "./pdfGeometry";
import type { PageGeometry, TextLine } from "./pdfGeometry";

const line = (text: string, x0: number, y0: number, x1: number, y1 = y0 + 10): TextLine => ({
  text,
  rect: { x0, y0, x1, y1 },
  fontSize: 10,
  spans: [{ text, rect: { x0, y0, x1, y1 }, fontSize: 10 }],
});

const page = (lines: TextLine[], width = 595, height = 842): PageGeometry => ({
  page: 1, size: { width, height }, lines, text: lines.map((l) => l.text).join("\n"),
  images: [], vectorOps: 5, hasSourceMarker: true,
});

/** Builds a row profile: `bands` are [startRow, endRow] inclusive inked rows. */
const profile = (height: number, bands: Array<[number, number]>, pointsPerRow = 1): RowProfile => {
  const occupied = new Array(height).fill(false);
  for (const [a, b] of bands) for (let r = a; r <= b; r++) occupied[r] = true;
  return {
    occupied, pointsPerRow,
    rowToPoints: (r) => r * pointsPerRow,
    pointsToRow: (p) => Math.floor(p / pointsPerRow),
    widthPx: 500, heightPx: height,
  };
};

describe("rasterizer discovery", () => {
  it("finds an installed rasterizer or reports none", () => {
    const r = discoverRasterizer();
    if (r) expect(["pdftoppm", "mutool"]).toContain(r.kind);
    else expect(findRasterizer("pdftoppm")).toBeNull();
  });

  it("throws PDF_RASTERIZER_NOT_AVAILABLE when nothing is installed", async () => {
    if (discoverRasterizer()) return; // environment has poppler; nothing to assert
    await expect(
      renderPdfPage({ pdfPath: "x.pdf", page: 1, outputPath: "y.png" }),
    ).rejects.toThrow(PDF_RASTERIZER_NOT_AVAILABLE);
  });

  it("rejects invalid page and dpi", async () => {
    await expect(renderPdfPage({ pdfPath: "a.pdf", page: 0, outputPath: "b.png" })).rejects.toThrow(RangeError);
    await expect(renderPdfPage({ pdfPath: "a.pdf", page: 1, dpi: 5000, outputPath: "b.png" })).rejects.toThrow(RangeError);
  });

  it("refuses to write outside the allowed root", async () => {
    await expect(
      renderPdfPage({ pdfPath: "a.pdf", page: 1, outputPath: "evil.png", allowedRoot: "some/where" }),
    ).rejects.toThrow(/refusing to write outside/);
  });

  it("reports a missing PDF clearly", async () => {
    await expect(
      renderPdfPage({ pdfPath: "definitely/not/here.pdf", page: 1, outputPath: "x.png" }),
    ).rejects.toThrow(/PDF not found/);
  });
});

describe("pdf points to pixels", () => {
  it("converts using 72 dpi user space", () => {
    expect(pdfPointsToPixels(72, 72)).toBe(72);
    expect(pdfPointsToPixels(72, 220)).toBe(220);
    expect(pdfPointsToPixels(0, 220)).toBe(0);
  });

  it("reads PNG dimensions from the IHDR chunk", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]),
      Buffer.from("IHDR", "ascii"),
      (() => { const b = Buffer.alloc(4); b.writeUInt32BE(300); return b; })(),
      (() => { const b = Buffer.alloc(4); b.writeUInt32BE(120); return b; })(),
    ]);
    const fs = await import("node:fs");
    const os = await import("node:os");
    const p = `${os.tmpdir()}/vylo-png-test.png`;
    fs.writeFileSync(p, png);
    expect(readPngSize(p)).toEqual({ width: 300, height: 120 });
    expect(readPngSize("nope.png")).toBeNull();
  });
});

describe("matrix handling", () => {
  it("accepts Float32Array matrices (pdfjs hands these over)", () => {
    expect(isMatrix(new Float32Array([1, 0, 0, 1, 5, 6]))).toBe(true);
    expect(isMatrix([1, 0, 0, 1, 0, 0])).toBe(true);
    expect(isMatrix([1, 0, 0])).toBe(false);
    expect(isMatrix([1, 0, 0, 1, NaN, 0])).toBe(false);
    expect(isMatrix(null)).toBe(false);
  });

  it("multiplies in the correct order (order matters)", () => {
    const scale = [2, 0, 0, 2, 0, 0];
    const move = [1, 0, 0, 1, 10, 20];
    // m·n applies n first, so the translation comes from the RIGHT operand.
    const afterScaleThenMove = multiplyMatrix(scale, move);
    expect(afterScaleThenMove[0]).toBe(2);
    expect(afterScaleThenMove[4]).toBe(30); // 2*10 + 10
    expect(afterScaleThenMove[5]).toBe(60); // 2*20 + 20
    // Reversing the operands genuinely changes the result.
    expect(multiplyMatrix(move, scale)[4]).toBe(0);
  });

  it("resets to identity rather than propagating NaN", () => {
    expect(multiplyMatrix([NaN, 0, 0, 1, 0, 0], IDENTITY)).toEqual(IDENTITY);
  });

  it("maps the unit square through the CTM with a top-left origin", () => {
    // ctm scales x by 10 and y by 20, translating to (100, 700) in PDF space.
    const r = unitSquareRect([10, 0, 0, 20, 100, 700], 842);
    expect(r.x0).toBeCloseTo(100);
    expect(r.x1).toBeCloseTo(110);
    expect(r.y0).toBeCloseTo(842 - 720);
    expect(r.y1).toBeCloseTo(842 - 700);
  });
});

describe("marker glyphs", () => {
  it("classifies standalone markers as non-prose", () => {
    for (const m of ["?", "→", "←", "↑", "↓", "•"]) expect(isMarkerGlyph(m)).toBe(true);
  });

  it("does not treat real prose as a marker", () => {
    for (const t of ["Left atrium.", "circumflex artery", "2) Identify this artery :"]) {
      expect(isMarkerGlyph(t)).toBe(false);
    }
  });

  it("excludes markers from the prose text column but keeps them in geometry", () => {
    const g = page([line("1) Identify this vein:", 50, 100, 200), line("?", 520, 300, 530)]);
    const prose = g.lines.filter(isProseLine);
    expect(prose).toHaveLength(1);
    expect(proseExtent(g.lines)).toEqual({ left: 50, right: 200 });
    // the marker is still present as page geometry (source evidence)
    expect(g.lines.some((l) => l.text === "?")).toBe(true);
  });
});

describe("vertical whitespace separators", () => {
  it("finds the largest blank run between two headers", () => {
    // header at row 10, current visual rows 20-60, blank 61-90, next visual 91-120
    const p = profile(200, [[10, 15], [20, 60], [91, 120]]);
    const r = findQuestionSeparatorY(p, 10, 130);
    expect(r.separatorY).toBeGreaterThan(60);
    expect(r.separatorY).toBeLessThan(91);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("places the boundary BEFORE the next question's first visual", () => {
    const p = profile(200, [[10, 15], [20, 60], [95, 130]]);
    const r = findQuestionSeparatorY(p, 10, 140);
    expect(r.separatorY).toBeLessThan(95);
  });

  it("never returns a separator at or beyond the next header", () => {
    const p = profile(100, [[0, 99]]); // fully inked: no whitespace at all
    const r = findQuestionSeparatorY(p, 10, 90);
    expect(r.separatorY).toBeLessThanOrEqual(90);
    expect(r.confidence).toBe(0);
  });

  it("extends a block upward when the visual starts above its caption", () => {
    const p = profile(200, [[0, 4], [8, 12], [30, 90]]);
    const top = findQuestionTopY(p, 80);
    expect(top.separatorY).toBeGreaterThan(4);
    expect(top.separatorY).toBeLessThan(30);
  });
});

describe("question blocks", () => {
  const g = page([
    line("2) Identify this artery :", 50, 160, 200),
    line("circumflex artery.", 50, 180, 160),
    line("?", 448, 519, 458),
    line("3) Identify this chamber:", 39, 554, 190),
    line("Left atrium.", 39, 574, 120),
  ]);

  it("parses numbered headers and keeps stems verbatim", () => {
    const b = segmentQuestionBlocks(g);
    expect(b).toHaveLength(2);
    expect(b[0].questionNumber).toBe(2);
    expect(b[0].stem).toBe("Identify this artery :");
    expect(b[0].printedAnswer).toBe("circumflex artery");
    expect(b[1].questionNumber).toBe(3);
  });

  it("applies a raster separator so a block stops before the next visual", () => {
    const base = segmentQuestionBlocks(g);
    const fixed = applySeparators(g, base, [{ separatorY: 443, confidence: 0.9, reason: "blank" }, null]);
    expect(fixed[0].rect.y1).toBeLessThanOrEqual(443);
    expect(fixed[1].rect.y0).toBeLessThanOrEqual(554);
  });

  it("keeps multi-image source as ONE question", () => {
    const b = segmentQuestionBlocks(g);
    expect(b).toHaveLength(2); // two questions, not one per image
  });
});

describe("student visual", () => {
  it("excludes the printed answer and the next question", () => {
    const g = page([
      line("2) Identify this artery :", 50, 160, 200),
      line("circumflex artery.", 50, 180, 160),
      line("?", 448, 519, 458),
      line("3) Identify this chamber:", 39, 554, 190),
    ]);
    const blocks = applySeparators(g, segmentQuestionBlocks(g), [{ separatorY: 443, confidence: 0.9, reason: "b" }, null]);
    const vis = studentVisualRect(blocks[0], g)!;
    expect(vis).not.toBeNull();
    // starts right of the prose column (200) so the red answer is excluded
    expect(vis.rect.x0).toBeGreaterThan(200);
    // the "?" marker at x 448-458 is INSIDE the visual (source marker preserved)
    expect(vis.rect.x0).toBeLessThan(448);
    // does not reach the next question
    expect(vis.rect.y1).toBeLessThanOrEqual(blocks[0].rect.y1);
  });

  it("produces a non-trivial crop", () => {
    const g = page([line("1) Identify this vein:", 50, 100, 200), line("Coronary sinus", 50, 120, 140)]);
    const b = applySeparators(g, segmentQuestionBlocks(g), [null])[0];
    const vis = studentVisualRect(b, g)!;
    expect(vis.rect.x1 - vis.rect.x0).toBeGreaterThan(50);
    expect(vis.rect.y1 - vis.rect.y0).toBeGreaterThan(20);
  });

  it("returns no visual when prose spans the page, and never draws an arrow", () => {
    // Prose runs to the page edge, so there is no separable visual column.
    const g = page([line("1) Identify this vein:", 50, 100, 560)]);
    const b = segmentQuestionBlocks(g)[0];
    expect(studentVisualRect(b, g)).toBeNull();
    // The visual API returns geometry only; nothing is ever drawn.
    const g2 = page([line("1) Identify this vein:", 50, 100, 200)]);
    const vis = studentVisualRect(segmentQuestionBlocks(g2)[0], g2)!;
    expect(Object.keys(vis.rect).sort()).toEqual(["x0", "x1", "y0", "y1"]);
  });
});

describe("safety gates", () => {
  const g = page([
    line("2) Identify this artery :", 50, 160, 200),
    line("circumflex artery.", 50, 180, 160),
    line("?", 448, 519, 458),
    line("3) Identify this chamber:", 39, 554, 190),
  ]);
  const blocks = applySeparators(g, segmentQuestionBlocks(g), [{ separatorY: 443, confidence: 0.9, reason: "b" }, null]);
  const answerLine = g.lines.find((l) => l.text === "circumflex artery.")!;

  it("detects overlap with the next question", () => {
    const bad = { x0: 300, y0: 200, x1: 560, y1: 600 }; // reaches into Q3
    const r = checkCropSafety(bad, g, blocks[0], blocks[1], (l) => l === answerLine);
    expect(r.contaminated).toBe(true);
    expect(r.warnings.join(" ")).toContain(NEXT_QUESTION_CONTAMINATION);
  });

  it("detects an answer leak", () => {
    const bad = { x0: 40, y0: 170, x1: 300, y1: 200 }; // covers the red answer
    const r = checkCropSafety(bad, g, blocks[0], blocks[1], (l) => l === answerLine);
    expect(r.answerLeak).toBe(true);
    expect(r.warnings.join(" ")).toContain(ANSWER_LEAK);
  });

  it("passes a clean crop", () => {
    const clean = { x0: 210, y0: 160, x1: 590, y1: 440 };
    const r = checkCropSafety(clean, g, blocks[0], blocks[1], (l) => l === answerLine);
    expect(r.contaminated).toBe(false);
    expect(r.answerLeak).toBe(false);
  });

  it("rectsOverlap is half-open so touching edges do not count", () => {
    expect(rectsOverlap({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 0, x1: 20, y1: 10 })).toBe(false);
    expect(rectsOverlap({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 9, y0: 0, x1: 20, y1: 10 })).toBe(true);
  });

  it("padRect clamps to page bounds", () => {
    const r = padRect({ x0: 2, y0: 2, x1: 8, y1: 8 }, 10, { width: 595, height: 842 });
    expect(r.x0).toBe(0);
    expect(r.y0).toBe(0);
  });
});
