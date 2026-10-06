/**
 * Deterministic distractor pools built ONLY from verified source answers.
 *
 * No medical term is ever invented: a distractor must already exist as a
 * verified answer in the same subject/category. If a compatible pool cannot
 * supply four safe, unique distractors the question is downgraded to
 * NEEDS_REVIEW rather than padded with guesses.
 */

export type Category =
  | "VESSEL" | "ARTERY" | "VEIN" | "CHAMBER" | "VALVE" | "SURFACE" | "GROOVE" | "CONDUCTION"
  | "RELATION" | "MUSCLE" | "FASCIA" | "ORGAN"
  | "LYMPHOID_ORGAN" | "BLOOD_CELL" | "HISTOLOGY_STRUCTURE"
  | "DIAGNOSIS" | "LAB_IDENTIFICATION" | "GENERIC";

export type PoolEntry = { answer: string; category: Category; subject: string | null; sourcePdf: string };

export type DistractorPool = Map<string, PoolEntry[]>;

const key = (subject: string | null, category: Category) => `${(subject ?? "*").toLowerCase()}|${category}`;

export function buildPools(verified: PoolEntry[]): DistractorPool {
  const pools: DistractorPool = new Map();
  for (const v of verified) {
    const k = key(v.subject, v.category);
    const list = pools.get(k) ?? [];
    if (!list.some((e) => e.answer.toLowerCase() === v.answer.toLowerCase())) list.push(v);
    pools.set(k, list);
  }
  return pools;
}

export function normaliseOption(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type FiveChoiceResult = {
  options: string[];
  correctOptionId: string | null;
  category: Category;
  ok: boolean;
  reason: string;
};

/**
 * Builds exactly five choices: the verified correct answer plus four verified
 * compatible distractors drawn from the pool.
 */
export function buildFiveChoices(
  correct: string,
  category: Category,
  subject: string | null,
  pools: DistractorPool,
): FiveChoiceResult {
  const pool = pools.get(key(subject, category)) ?? [];
  const correctNorm = normaliseOption(correct);
  if (!correct || !correctNorm) {
    return { options: [], correctOptionId: null, category, ok: false, reason: "no verified correct answer" };
  }

  const seen = new Set<string>([correctNorm]);
  const distractors: string[] = [];
  for (const entry of pool) {
    if (distractors.length >= 4) break;
    const n = normaliseOption(entry.answer);
    if (!n || seen.has(n)) continue;
    // A distractor that contains the correct answer (or vice versa) would make
    // two options effectively correct.
    if (n.includes(correctNorm) || correctNorm.includes(n)) continue;
    seen.add(n);
    distractors.push(entry.answer);
  }

  if (distractors.length < 4) {
    return {
      options: [],
      correctOptionId: null,
      category,
      ok: false,
      reason: `insufficient verified distractors in pool ${key(subject, category)} (have ${distractors.length}, need 4)`,
    };
  }

  // Deterministic ordering: correct first, then pool order.
  const options = [correct, ...distractors];
  return { options, correctOptionId: "a", category, ok: true, reason: "verified correct answer + 4 verified compatible distractors" };
}

const CATEGORY_HINTS: [RegExp, Category][] = [
  [/\b(artery|arterial)\b/i, "ARTERY"],
  [/\b(vein|venous)\b/i, "VEIN"],
  [/\b(valve|valvular)\b/i, "VALVE"],
  [/\b(chamber|atrium|ventricle)\b/i, "CHAMBER"],
  [/\b(groove|sulcus)\b/i, "GROOVE"],
  [/\b(conduction|bundle|node)\b/i, "CONDUCTION"],
  [/\b(surface|landmark|aperture)\b/i, "SURFACE"],
  [/\b(branch|relation|related|supplied|originates)\b/i, "RELATION"],
  [/\b(muscle|muscular)\b/i, "MUSCLE"],
  [/\b(fascia|fascial|aponeurosis)\b/i, "FASCIA"],
  [/\b(kidney|renal|liver|ureter|bladder|spleen|stomach)\b/i, "ORGAN"],
  [/\b(lymph|tonsil|node|thymus)\b/i, "LYMPHOID_ORGAN"],
  [/\b(neutrophil|lymphocyte|monocyte|eosinophil|basophil|platelet|red cell|wbc|rbc)\b/i, "BLOOD_CELL"],
  [/\b(tissue|epithelium|stroma|parenchyma|cortex|medulla)\b/i, "HISTOLOGY_STRUCTURE"],
  [/\b(vessel|vein|artery|capillary)\b/i, "VESSEL"],
];

/** Assigns a semantic category so distractors are only drawn from peers. */
export function categorise(answer: string): Category {
  for (const [re, cat] of CATEGORY_HINTS) {
    if (re.test(answer)) return cat;
  }
  return "GENERIC";
}

/** Rejects a candidate distractor that is not compatible with the category. */
export function isCompatibleDistractor(correctCategory: Category, candidate: string, candidateCategory: Category): boolean {
  if (correctCategory === "GENERIC") return true;
  if (candidateCategory === correctCategory) return true;
  // VESSEL is a safe superset for artery/vein peers of the same subject.
  if (correctCategory === "VESSEL" && (candidateCategory === "ARTERY" || candidateCategory === "VEIN")) return true;
  return false;
}
