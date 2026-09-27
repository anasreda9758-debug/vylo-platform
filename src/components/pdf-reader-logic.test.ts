import { describe, expect, it } from "vitest";
import {
  clampPage, clampScale, fitPageScale, fitWidthScale, findSearchHits, hasSearchableText,
  readerShortcut, resolveRange, stepHit, thumbnailWindow, MAX_SCALE, MIN_SCALE,
} from "./pdf-reader-logic";

describe("scale clamping and zoom", () => {
  it("clamps to the supported range", () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it("survives non-numeric input", () => {
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe("fit modes", () => {
  it("fit width scales the page to the viewport", () => {
    // 595pt page into 800px -> ~1.31
    expect(fitWidthScale(800, 595)).toBeCloseTo(1.3, 2); // 24px gutter
  });

  it("fit width never exceeds the max zoom", () => {
    expect(fitWidthScale(5000, 595)).toBeLessThanOrEqual(MAX_SCALE);
  });

  it("fit page respects the shorter dimension", () => {
    // height is the constraint here
    const s = fitPageScale(1000, 600, 595, 842);
    expect(s).toBeCloseTo(576 / 842, 2); // 24px gutter
  });

  it("fit page never exceeds fit width", () => {
    expect(fitPageScale(1000, 100000, 595, 842)).toBeLessThanOrEqual(fitWidthScale(1000, 595));
  });

  it("handles a zero-size viewport without dividing by zero", () => {
    expect(fitWidthScale(0, 595)).toBe(1);
    expect(fitPageScale(0, 0, 0, 0)).toBe(1);
  });
});

describe("page range and navigation", () => {
  it("resolves a full document range", () => {
    expect(resolveRange(10, null, null)).toEqual({ min: 1, max: 10, hasRange: false });
  });

  it("honours a lecture page slice", () => {
    expect(resolveRange(50, 10, 20)).toEqual({ min: 10, max: 20, hasRange: true });
  });

  it("clamps a slice to the real document length", () => {
    expect(resolveRange(12, 10, 99)).toEqual({ min: 10, max: 12, hasRange: true });
  });

  it("clamps navigation to the readable range", () => {
    expect(clampPage(0, 1, 5)).toBe(1);
    expect(clampPage(9, 1, 5)).toBe(5);
    expect(clampPage(3, 1, 5)).toBe(3);
  });

  it("never navigates into the slice prefix", () => {
    expect(clampPage(2, 10, 20)).toBe(10);
  });
});

describe("search", () => {
  const pages = [
    { page: 3, text: "The pericardium is a fibrous sac that surrounds the heart." },
    { page: 7, text: "Hypertrophy causes reduced cardiac output." },
  ];

  it("finds matches across pages", () => {
    const hits = findSearchHits(pages, "cardiac");
    expect(hits).toHaveLength(1);
    expect(hits[0].page).toBe(7);
  });

  it("is case-insensitive", () => {
    expect(findSearchHits(pages, "PERICARDIUM")).toHaveLength(1);
  });

  it("returns nothing for a very short query", () => {
    expect(findSearchHits(pages, "a")).toHaveLength(0);
  });

  it("returns nothing when the query is absent", () => {
    expect(findSearchHits(pages, "gastroenteritis")).toHaveLength(0);
  });

  it("wraps around at both ends", () => {
    const hits = findSearchHits([{ page: 1, text: "alpha alpha alpha" }], "alpha");
    expect(hits.length).toBe(3);
    expect(stepHit(hits, 2, 1)).toBe(0);
    expect(stepHit(hits, 0, -1)).toBe(2);
  });

  it("handles an empty result set", () => {
    expect(stepHit([], 0, 1)).toBe(0);
  });

  it("detects an unusable text layer", () => {
    expect(hasSearchableText(0)).toBe(false);
    expect(hasSearchableText(5000)).toBe(true);
  });
});

describe("thumbnail windowing", () => {
  it("only mounts thumbnails near the current page", () => {
    expect(thumbnailWindow(50, 400, 3)).toEqual([47, 48, 49, 50, 51, 52, 53]);
  });

  it("clamps at the document start", () => {
    expect(thumbnailWindow(1, 10, 3)).toEqual([1, 2, 3, 4]);
  });

  it("clamps at the document end", () => {
    expect(thumbnailWindow(10, 10, 3)).toEqual([7, 8, 9, 10]);
  });

  it("returns nothing for an unknown document", () => {
    expect(thumbnailWindow(1, 0)).toEqual([]);
  });
});

describe("keyboard shortcuts", () => {
  it("maps navigation keys", () => {
    expect(readerShortcut("ArrowLeft", false)).toBe("prev");
    expect(readerShortcut("ArrowRight", false)).toBe("next");
    expect(readerShortcut("Home", false)).toBe("first");
    expect(readerShortcut("End", false)).toBe("last");
  });

  it("maps zoom and panel keys", () => {
    expect(readerShortcut("+", false)).toBe("zoomIn");
    expect(readerShortcut("-", false)).toBe("zoomOut");
    expect(readerShortcut("f", false)).toBe("search");
    expect(readerShortcut("t", false)).toBe("thumbnails");
  });

  it("never steals keys while the student is typing", () => {
    for (const k of ["ArrowLeft", "ArrowRight", "f", "t", "+"]) {
      expect(readerShortcut(k, true)).toBeNull();
    }
  });

  it("ignores unrelated keys", () => {
    expect(readerShortcut("q", false)).toBeNull();
  });
});
