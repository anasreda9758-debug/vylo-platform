/**
 * Strict question-number detection and sequence validation.
 *
 * V2 reported a bogus "maxQ = 500" for OSPE RESP because the numbering regex
 * accepted any line starting with digits followed by whitespace. The real line
 * was `500 ml.` — a clinical volume on page 89, not a question.
 *
 * Rules enforced here:
 *  - a bare number needs an explicit `[.):]` separator AND a plausible stem;
 *  - `Q` / `Question` may omit the separator but still needs a stem;
 *  - a number immediately followed by a decimal digit is not a question number;
 *  - a number followed by a measurement unit (ml, mg, %, bpm, ...) is a
 *    measurement, never a question;
 *  - the surviving sequence is validated so a single outlier cannot become the
 *    document maximum.
 */

/** Units that turn a bare number into a clinical measurement. */
const UNIT = /^(?:ml|ml\.|l|l\.|mg|mg\.|g|g\.|kg|µg|ug|mcg|dl|dl\.|mm|mm\.|cm|cm\.|m|mmHg|mmhg|%|bpm|bpm\.|hz|hz\.|iu|iu\.|mEq|meq|mEq\/L|mmol|mmol\/L|micrograms?|milligrams?|grams?|milliliters?|millilitres?|degrees?|yrs?|years?|days?|weeks?|months?|hours?|min|sec|units?)\b/i;

/** A stem must contain at least one letter and not look like a bare number. */
function plausibleStem(body: string): boolean {
  const t = body.trim();
  if (t.length < 3) return false;
  if (!/[A-Za-z؀-ۿ]/.test(t)) return false;
  if (/^[\d\s.,:%()-]+$/.test(t)) return false;
  return true;
}

export type NumberHit = {
  number: number;
  /** Text with the number token removed. */
  body: string;
  /** True when an explicit Q / Question prefix was present. */
  prefixed: boolean;
  reason: string;
};

/**
 * Extracts a question number from the START of a line, or null when the line
 * is not a question-numbered stem.
 */
export function detectQuestionNumber(line: string): NumberHit | null {
  const raw = line.replace(/\s+/g, " ").trim();

  // 1) Explicit "Q"/"Question" prefix — separator optional, stem required.
  const prefixed = /^(?:Q|Question)\s*(\d{1,3})\s*([.):])?\s*(\S.*)$/i.exec(raw);
  if (prefixed) {
    const body = prefixed[3] ?? "";
    if (plausibleStem(body)) {
      return { number: Number(prefixed[1]), body: body.trim(), prefixed: true, reason: "Q-prefixed stem" };
    }
    return null;
  }

  // 2) Bare number: REQUIRES an explicit separator, then a stem.
  const bare = /^(\d{1,3})\s*([.):])\s*(\S.*)$/.exec(raw);
  if (bare) {
    const digits = bare[1];
    const body = (bare[3] ?? "").trim();
    // "12.5 mg" would otherwise yield number 12 with body "5 mg".
    if (/^\d/.test(body)) return null;
    if (UNIT.test(body)) return null;
    if (!plausibleStem(body)) return null;
    return { number: Number(digits), body, prefixed: false, reason: "separator + stem" };
  }

  // 3) "500 ml." and friends: number + unit with no separator => measurement.
  return null;
}

/** True when a line looks like a measurement rather than a question. */
export function isMeasurementLine(line: string): boolean {
  return /^\s*\d+(?:\.\d+)?\s*[A-Za-zµ%]/.test(line) && UNIT.test(line.replace(/^\s*\d+(?:\.\d+)?\s*/, ""));
}

export type SequenceValidation = {
  numbers: number[];
  /** Highest number before outlier rejection (may be bogus). */
  rawMax: number;
  /** Highest number after outlier rejection. */
  validatedMax: number;
  duplicates: number[];
  /** Genuine gaps inside [min, validatedMax]. */
  gaps: number[];
  /** Numbers rejected as statistical outliers. */
  outliers: number[];
  rejected: { number: number; reason: string }[];
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Rejects sequence outliers using the median absolute deviation, so one stray
 * "Q500" cannot become the document maximum when the bank really runs Q1..Q130.
 */
export function validateSequence(numbers: number[]): SequenceValidation {
  const sorted = [...numbers].sort((a, b) => a - b);
  const rawMax = sorted.length ? sorted[sorted.length - 1] : 0;
  const rejected: { number: number; reason: string }[] = [];

  let kept = sorted;
  if (sorted.length >= 8) {
    const med = median(sorted);
    const mad = median(sorted.map((n) => Math.abs(n - med)));
    // Generous bound: a real question bank is near-contiguous, so a large
    // absolute jump from the median is an artefact, not a question.
    const bound = Math.max(med * 1.5 + 10, med + 6 * (mad || 1));
    kept = sorted.filter((n) => {
      if (n <= bound) return true;
      rejected.push({ number: n, reason: `NUMBER_OUTLIER (median=${med}, bound=${Math.round(bound)})` });
      return false;
    });
  }

  const uniq = [...new Set(kept)].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const n of kept) counts.set(n, (counts.get(n) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b);

  const validatedMax = uniq.length ? uniq[uniq.length - 1] : 0;
  const gaps: number[] = [];
  if (uniq.length) {
    for (let n = uniq[0]; n <= validatedMax; n++) if (!uniq.includes(n)) gaps.push(n);
  }

  return { numbers: uniq, rawMax, validatedMax, duplicates, gaps, outliers: rejected.map((r) => r.number), rejected };
}
