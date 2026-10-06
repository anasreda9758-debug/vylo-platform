/**
 * CVS practical-bank capacity model.
 *
 * Distinguishes a CANONICAL SOURCE QUESTION from a derived PRACTICE QUESTION,
 * requires every generated question to cite a verified FACT ATOM, removes
 * semantic duplicates, and reports an honest shortfall when the source cannot
 * support the module target.
 *
 * Nothing here invents a medical fact: questions are only derived from atoms
 * that already carry a verified structure and a source image reference.
 */

export const TARGET_APPROVED_PER_MODULE = 300;
export const PREFERRED_CANDIDATE_POOL = 350;

export type QualityTier = "A_SOURCE_VERIFIED" | "B_DERIVED_VERIFIED" | "C_NEEDS_REVIEW" | "D_REJECT";

export type FactAtom = {
  id: string;
  /** Verified structure / answer text taken from the source. */
  structure: string;
  category: string;
  subject: string;
  sourcePdf: string;
  sourcePage: number | null;
  sourceImage: string | null;
  /** Verified source statement, when the source provides one. */
  relation?: { kind: string; target: string } | null;
  /** True when the atom's source answer was verified against the PDF text. */
  answerVerified: boolean;
};

export type CandidateQuestion = {
  id: string;
  factIds: string[];
  stem: string;
  semanticType: "IDENTIFICATION" | "RELATION" | "ORIGIN" | "SURFACE_ANATOMY" | "BORDER" | "HISTOLOGY_LABEL" | "DIAGNOSIS";
  correctAnswer: string;
  sourceImage: string | null;
  options: string[];
  correctOptionId: string | null;
  tier: QualityTier;
  warnings: string[];
};

export function normalise(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Semantic duplicate signature. Two candidates collide when they test the same
 * fact for the same semantic task against the same answer and image — wording
 * differences and option shuffles must NOT create new questions.
 */
export function duplicateSignature(q: CandidateQuestion): string {
  const facts = [...q.factIds].sort().join("+");
  const opts = [...q.options].map(normalise).sort().join("|");
  return [
    facts,
    q.semanticType,
    normalise(q.correctAnswer),
    normalise(q.sourceImage ?? ""),
    // Option ORDER is deliberately excluded so a shuffle dedupes to one question.
    opts ? `opts:${opts}` : "noopts",
  ].join("|");
}

/** Collapses candidates onto unique logical questions. */
export function dedupeCandidates(candidates: CandidateQuestion[]): { unique: CandidateQuestion[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: CandidateQuestion[] = [];
  let duplicates = 0;
  for (const c of candidates) {
    const sig = duplicateSignature(c);
    if (seen.has(sig)) {
      duplicates += 1;
      continue;
    }
    seen.add(sig);
    unique.push(c);
  }
  return { unique, duplicates };
}

/**
 * Derives practice questions from verified fact atoms.
 *
 * A fact yields:
 *  - one IDENTIFICATION question (always, when the structure is verified), and
 *  - one RELATION/ORIGIN question ONLY when the source itself states the
 *    relation cleanly. No reverse/inferred relations are generated.
 */
export function deriveQuestionsFromFacts(
  facts: FactAtom[],
  opts: { makeOptions: (fact: FactAtom, answer: string) => { options: string[]; correctOptionId: string | null; warnings: string[] } } ,
): CandidateQuestion[] {
  const out: CandidateQuestion[] = [];
  for (const f of facts) {
    if (!f.answerVerified || !f.structure.trim()) continue;
    const warnings: string[] = [];

    const identOpts = opts.makeOptions(f, f.structure);
    out.push({
      id: `${f.id}:ident`,
      factIds: [f.id],
      stem: `Identify the structure marked in ${f.sourceImage ?? "the source image"}.`,
      semanticType: "IDENTIFICATION",
      correctAnswer: f.structure,
      sourceImage: f.sourceImage,
      options: identOpts.options,
      correctOptionId: identOpts.correctOptionId,
      tier: identOpts.correctOptionId ? "A_SOURCE_VERIFIED" : "C_NEEDS_REVIEW",
      warnings: [...warnings, ...identOpts.warnings],
    });

    if (f.relation && f.relation.target.trim()) {
      const relOpts = opts.makeOptions(f, f.relation.target);
      out.push({
        id: `${f.id}:${f.relation.kind.toLowerCase()}`,
        factIds: [f.id],
        stem: `${f.structure} is a ${f.relation.kind === "ORIGIN" ? "branch of" : "branch of"}:`,
        semanticType: f.relation.kind === "ORIGIN" ? "ORIGIN" : "RELATION",
        correctAnswer: f.relation.target,
        sourceImage: f.sourceImage,
        options: relOpts.options,
        correctOptionId: relOpts.correctOptionId,
        tier: relOpts.correctOptionId ? "B_DERIVED_VERIFIED" : "C_NEEDS_REVIEW",
        warnings: relOpts.warnings,
      });
    }
  }
  return out;
}

export type CapacityReport = {
  canonicalSourceQuestions: number;
  verifiedFactAtoms: number;
  rawGeneratedCandidates: number;
  duplicatesRemoved: number;
  uniqueCandidates: number;
  sourceVerified: number;
  derivedVerified: number;
  needsReview: number;
  rejected: number;
  totalUniqueUsableCandidates: number;
  targetApproved: number;
  gapToTarget: number;
  gapToPreferredPool: number;
  meetsTarget: boolean;
  meetsPreferredPool: boolean;
  shortfall: boolean;
};

export function computeCapacity(input: {
  canonicalSourceQuestions: number;
  factAtoms: number;
  rawCandidates: number;
  duplicatesRemoved: number;
  unique: CandidateQuestion[];
}): CapacityReport {
  const sourceVerified = input.unique.filter((q) => q.tier === "A_SOURCE_VERIFIED").length;
  const derivedVerified = input.unique.filter((q) => q.tier === "B_DERIVED_VERIFIED").length;
  const needsReview = input.unique.filter((q) => q.tier === "C_NEEDS_REVIEW").length;
  const rejected = input.unique.filter((q) => q.tier === "D_REJECT").length;
  // Only A and B can realistically reach APPROVED without owner work.
  const totalUniqueUsableCandidates = sourceVerified + derivedVerified;
  const gapToTarget = Math.max(0, TARGET_APPROVED_PER_MODULE - totalUniqueUsableCandidates);
  const gapToPreferredPool = Math.max(0, PREFERRED_CANDIDATE_POOL - input.unique.length);
  return {
    canonicalSourceQuestions: input.canonicalSourceQuestions,
    verifiedFactAtoms: input.factAtoms,
    rawGeneratedCandidates: input.rawCandidates,
    duplicatesRemoved: input.duplicatesRemoved,
    uniqueCandidates: input.unique.length,
    sourceVerified,
    derivedVerified,
    needsReview,
    rejected,
    totalUniqueUsableCandidates,
    targetApproved: TARGET_APPROVED_PER_MODULE,
    gapToTarget,
    gapToPreferredPool,
    meetsTarget: totalUniqueUsableCandidates >= TARGET_APPROVED_PER_MODULE,
    meetsPreferredPool: input.unique.length >= PREFERRED_CANDIDATE_POOL,
    shortfall: totalUniqueUsableCandidates < TARGET_APPROVED_PER_MODULE,
  };
}

export function renderCapacityMarkdown(r: CapacityReport, extra: Record<string, unknown> = {}): string {
  const L: string[] = [];
  L.push("# CVS Practical Bank — Capacity Model");
  L.push("");
  L.push("> Capacity + benchmark analysis only. **Nothing was imported or published.**");
  L.push("");
  if (extra.sourceNotes) {
    L.push("## Source notes");
    L.push("");
    for (const n of extra.sourceNotes as string[]) L.push(`- ${n}`);
    L.push("");
  }
  L.push("## Capacity");
  L.push("");
  L.push("| Metric | Value |");
  L.push("|---|---:|");
  L.push(`| Canonical source questions (numbered PDF) | ${r.canonicalSourceQuestions} |`);
  L.push(`| Verified fact atoms | ${r.verifiedFactAtoms} |`);
  L.push(`| Raw generated candidates | ${r.rawGeneratedCandidates} |`);
  L.push(`| Semantic duplicates removed | ${r.duplicatesRemoved} |`);
  L.push(`| Unique candidates | ${r.uniqueCandidates} |`);
  L.push(`| A — SOURCE_VERIFIED | ${r.sourceVerified} |`);
  L.push(`| B — DERIVED_VERIFIED | ${r.derivedVerified} |`);
  L.push(`| C — NEEDS_REVIEW | ${r.needsReview} |`);
  L.push(`| D — REJECT | ${r.rejected} |`);
  L.push(`| **Total unique usable (A+B)** | **${r.totalUniqueUsableCandidates}** |`);
  L.push(`| Target approved | ${r.targetApproved} |`);
  L.push(`| **Gap to 300** | **${r.gapToTarget}** |`);
  L.push(`| Gap to preferred pool (350) | ${r.gapToPreferredPool} |`);
  L.push("");
  if (extra.alternativeView) {
    L.push("### Alternative dedup policy — owner decision required");
    L.push("");
    for (const n of extra.alternativeView as string[]) L.push(`- ${n}`);
    L.push("");
  }
  if (r.shortfall) {
    L.push("## SOURCE CAPACITY SHORTFALL");
    L.push("");
    L.push(`The verified CVS source material supports **${r.totalUniqueUsableCandidates}** grounded questions that could reach APPROVED.`);
    L.push(`The module target is ${r.targetApproved}. **Shortfall: ${r.gapToTarget} questions.**`);
    L.push("");
    L.push("No questions were fabricated or padded to close this gap. Closing it requires additional");
    L.push("verified source material (more labelled images/specimens), not option shuffles or rewording.");
  } else {
    L.push("## Capacity target met");
    L.push("");
    L.push(`Usable grounded candidates (${r.totalUniqueUsableCandidates}) meet the ${r.targetApproved} target.`);
  }
  L.push("");
  return L.join("\n");
}
