/**
 * Verified answer resolution for PDF-first practical questions.
 *
 * Ground-truth policy: a correct answer is only ever accepted when it is
 * present in the source material (printed on the PDF) AND, where an answer key
 * exists, corroborated by it. The answer key supplies answers ONLY — the PDF
 * remains the source of stems, images and options. AI is never a source of
 * medical truth, and an unverifiable answer stays unresolved rather than being
 * guessed.
 */

export type MatchConfidence = "EXACT" | "STRONG" | "AMBIGUOUS" | "NONE";

export type AnswerKeyRow = {
  id: string;
  folder: string;
  fileName: string;
  /** Empty for folders where the key stores prompts rather than answers. */
  diagnosis: string;
  identification: string | null;
};

export type AnswerResolution = {
  confidence: MatchConfidence;
  answer: string | null;
  /** Which sources agreed, for audit. */
  verifiedBy: Array<"PDF_PRINTED_ANSWER" | "ANSWER_KEY_DIAGNOSIS">;
  answerKeyId: string | null;
  reason: string;
};

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Anatomical synonyms that must not be treated as a contradiction. */
const EQUIVALENCE: Array<[string, string]> = [
  ["left atrium", "atrium sinistrum"],
  ["circumflex artery", "circumflex branch of the left coronary artery"],
  ["superior vena cava", "vena cava superior"],
  ["ascending aorta", "aorta ascendens"],
];

const equivalent = (a: string, b: string): boolean => {
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return true;
  for (const [x, y] of EQUIVALENCE) {
    if ((na === normalise(x) && nb === normalise(y)) || (na === normalise(y) && nb === normalise(x))) return true;
  }
  return false;
};

/**
 * Scores a candidate answer against every answer in a folder.
 *
 * EXACT   — the PDF answer is byte-equivalent to a key answer.
 * STRONG  — it matches under normalisation, or is a known anatomical synonym.
 * AMBIGUOUS — more than one key answer matched, or only a weak overlap exists.
 * NONE    — nothing in the key supports it, or the key holds no answers.
 */
export const resolveVerifiedAnswer = (
  printedAnswer: string | null,
  rows: AnswerKeyRow[],
  opts: { requireKey?: boolean } = {},
): AnswerResolution => {
  if (!printedAnswer || !printedAnswer.trim()) {
    return { confidence: "NONE", answer: null, verifiedBy: [], answerKeyId: null, reason: "no answer printed in the PDF" };
  }

  // A key that stores prompts instead of answers cannot verify anything.
  const answerRows = rows.filter((r) => r.diagnosis && r.diagnosis.trim());
  if (!answerRows.length) {
    return {
      confidence: "NONE",
      answer: opts.requireKey ? null : printedAnswer,
      verifiedBy: opts.requireKey ? [] : ["PDF_PRINTED_ANSWER"],
      answerKeyId: null,
      reason: "answer key holds no diagnosis values for this folder; PDF answer accepted unverified",
    };
  }

  const exact = answerRows.find((r) => r.diagnosis.trim() === printedAnswer.trim());
  if (exact) {
    return { confidence: "EXACT", answer: exact.diagnosis.trim(), verifiedBy: ["PDF_PRINTED_ANSWER", "ANSWER_KEY_DIAGNOSIS"], answerKeyId: exact.id, reason: "printed answer is identical to an answer-key diagnosis" };
  }

  const strong = answerRows.find((r) => equivalent(r.diagnosis, printedAnswer));
  if (strong) {
    return { confidence: "STRONG", answer: strong.diagnosis.trim(), verifiedBy: ["PDF_PRINTED_ANSWER", "ANSWER_KEY_DIAGNOSIS"], answerKeyId: strong.id, reason: "printed answer matches an answer-key diagnosis after normalisation/synonym check" };
  }

  const loose = answerRows.filter((r) => {
    const a = normalise(r.diagnosis);
    const b = normalise(printedAnswer);
    return a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a));
  });
  if (loose.length === 1) {
    return { confidence: "AMBIGUOUS", answer: null, verifiedBy: ["PDF_PRINTED_ANSWER"], answerKeyId: null, reason: `only a partial overlap with "${loose[0].diagnosis}"; not accepted` };
  }
  if (loose.length > 1) {
    return { confidence: "AMBIGUOUS", answer: null, verifiedBy: ["PDF_PRINTED_ANSWER"], answerKeyId: null, reason: `ambiguous: ${loose.length} key answers partially match; not accepted` };
  }

  return { confidence: "NONE", answer: null, verifiedBy: ["PDF_PRINTED_ANSWER"], answerKeyId: null, reason: "no answer-key entry matches the printed answer" };
};

/** Only EXACT/STRONG may be auto-verified; everything else requires a human. */
export const isAutoVerifiable = (c: MatchConfidence): boolean => c === "EXACT" || c === "STRONG";

/**
 * Distractor pool restricted to key answers of the same category, so derived
 * practice options can never introduce an unverified medical term.
 */
export const verifiedDistractorPool = (rows: AnswerKeyRow[], exclude: string): string[] => {
  const out: string[] = [];
  const seen = new Set([normalise(exclude)]);
  for (const r of rows) {
    const d = r.diagnosis?.trim();
    if (!d) continue;
    const k = normalise(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
};
