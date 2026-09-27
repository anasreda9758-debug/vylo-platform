/**
 * Source-pointer detection.
 *
 * V2 claimed "pointerMode = SOURCE" for every candidate because it inferred a
 * marker from `vectorOps >= 8` — but any embedded photo also emits vector ops,
 * so that told us nothing. V2's "666 source markers / 0 manual" is retracted.
 *
 * A pointer is only CONFIRMED when page geometry actually links a marker to a
 * target: a bare "?" glyph, or a numbered/lettered tag, that sits INSIDE the
 * question's own panel. Vector-op counts are recorded as a weak hint only.
 */
export type PointerMode = "SOURCE_CONFIRMED" | "SOURCE_POSSIBLE" | "NONE" | "MANUAL_REQUIRED";
export type PointerEvidence = {
  mode: PointerMode;
  /** Bounding boxes of marker glyphs found inside the panel. */
  markers: { x0: number; y0: number; x1: number; y1: number }[];
  /** Weak, non-authoritative hint retained for diagnostics only. */
  vectorOpHint: number;
  reason: string;
};

const MARKER_GLYPH = /^\s*[?؟]\s*$/;
const TAGGED_MARKER = /^\s*(?:\(\s*\d{1,2}\s*\)|\d{1,2}\s*[.)]?|[a-eA-E]\s*[.)])\s*$/;

export function isMarkerGlyph(text: string): boolean {
  const t = text.trim();
  return MARKER_GLYPH.test(t) || TAGGED_MARKER.test(t);
}

export type PointerInput = {
  /** Text lines belonging to the question's panel. */
  panelLines: { text: string; x0: number; y0: number; x1: number; y1: number }[];
  /** Page-wide vector op count — a hint, never proof. */
  vectorOps: number;
  /** True when the panel already has an associated image/crop. */
  hasImage: boolean;
};

export function detectPointer(input: PointerInput): PointerEvidence {
  const markers = input.panelLines.filter((l) => isMarkerGlyph(l.text));

  if (markers.length > 0) {
    return {
      mode: "SOURCE_CONFIRMED",
      markers,
      vectorOpHint: input.vectorOps,
      reason: `${markers.length} marker glyph(s) inside the question panel`,
    };
  }

  if (input.hasImage) {
    // The source ships a picture for this question. A marker may well be baked
    // into the raster, but we cannot prove it from the text layer.
    return {
      mode: "SOURCE_POSSIBLE",
      markers: [],
      vectorOpHint: input.vectorOps,
      reason: "panel has an associated image; marker may be rasterised in the source",
    };
  }

  if (input.vectorOps >= 8) {
    return {
      mode: "SOURCE_POSSIBLE",
      markers: [],
      vectorOpHint: input.vectorOps,
      reason: "vector drawing ops present but not attributable to a marker (weak hint only)",
    };
  }

  return {
    mode: "MANUAL_REQUIRED",
    markers: [],
    vectorOpHint: input.vectorOps,
    reason: "no marker glyph and no associated image",
  };
}
