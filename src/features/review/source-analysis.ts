/**
 * Deterministic source analysis for lecture-derived study material.
 *
 * The local fallback (no hosted model) must still be genuinely useful, so this
 * module extracts structured facts from the lecture text instead of echoing
 * raw sentences. It is fully deterministic and language-aware for English and
 * Arabic: nothing here invents a fact that is not present in the source.
 */

export type RelationKind =
  | "DEFINITION"
  | "CAUSE"
  | "FEATURE"
  | "CLASSIFICATION"
  | "COMPARISON"
  | "PROCESS"
  | "PURPOSE";

export type Fact = {
  kind: RelationKind;
  /** The thing being described. */
  subject: string;
  /** The statement that belongs to the subject. */
  detail: string;
  /** Comparison counterpart, when present. */
  counterpart?: string;
  sentence: string;
  /** Longer text is more reliable, so ordering prefers it. */
  weight: number;
};

export type ConceptNode = {
  label: string;
  detail: string;
  kind: RelationKind;
  children: ConceptNode[];
};

/* ------------------------------------------------------------------ */
/* language helpers                                                    */
/* ------------------------------------------------------------------ */

export const hasArabic = (s: string): boolean => /[\u0600-\u06FF]/.test(s);
export const hasLatin = (s: string): boolean => /[A-Za-z]/.test(s);

const AR_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

/** Normalises Arabic orthography so "القلب" and "القلب" compare equal. */
export const normaliseArabic = (s: string): string =>
  s
    .replace(AR_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

/** Comparison key used for dedup. Aggressive on purpose. */
export const normaliseForCompare = (s: string): string => {
  const base = hasArabic(s) ? normaliseArabic(s) : s;
  return base
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\b(the|a|an|of|is|are|in|to|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const STOPWORDS = new Set([
  "the", "a", "an", "of", "is", "are", "was", "were", "in", "on", "to", "and", "or",
  "for", "with", "by", "as", "at", "this", "that", "these", "those", "it", "its",
  "من", "في", "على", "الى", "إلى", "عن", "مع", "او", "أو", "و", "هو", "هي", "هذا", "هذه", "التي", "الذي",
]);

export const tokenise = (s: string): string[] =>
  normaliseForCompare(s)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

/** Jaccard overlap on content words — the basis of semantic-ish dedup. */
export const similarity = (a: string, b: string): number => {
  const ta = new Set(tokenise(a));
  const tb = new Set(tokenise(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
};

export const deduplicate = <T>(items: T[], key: (t: T) => string, threshold = 0.72): T[] => {
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (out.some((kept) => similarity(key(kept), k) >= threshold)) continue;
    out.push(item);
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* sentence splitting                                                  */
/* ------------------------------------------------------------------ */

const ABBREV = /\b(?:e\.g|i\.e|etc|vs|approx|Dr|Mr|Mrs|St|Fig|No)\.$/i;

export const splitSentences = (content: string): string[] => {
  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  // Split on . ! ? and the Arabic equivalents, plus newlines/semicolons.
  const raw = flat
    .split(/(?<=[.!?؟。])\s+|\n+|(?:;(?=\s))/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const merged: string[] = [];
  for (const piece of raw) {
    const prev = merged[merged.length - 1];
    if (prev && ABBREV.test(prev)) merged[merged.length - 1] = `${prev} ${piece}`;
    else merged.push(piece);
  }
  return merged;
};

/* ------------------------------------------------------------------ */
/* relation patterns                                                   */
/* ------------------------------------------------------------------ */

type Rule = { kind: RelationKind; re: RegExp; groups: { subject: number; detail?: number; counterpart?: number } };

/**
 * Ordered by specificity. Each rule captures a subject and the statement about
 * it. Patterns cover English and Arabic so an Arabic lecture is analysed just as
 * well as an English one.
 *
 * "X is known as Y" must be matched BEFORE the generic "X is Y" rule, otherwise
 * the term being defined ("hemopericardium") is lost and the phrase before the
 * copula ("Blood in the pericardial space") is wrongly reported as the subject.
 */
const RULES: Rule[] = [
  // "X is known as Y" defines Y, so Y is the term and X is the description.
  { kind: "DEFINITION", re: /\b(.{3,80}?)\s+(?:is|are)\s+(?:known as|termed|called|named)\s+(.{3,120}?)[.;]/i, groups: { subject: 2, detail: 1 } },
  { kind: "DEFINITION", re: /\b([A-Z][A-Za-z0-9'\- ]{2,70}?)\s+(?:refers to|means|denotes)\s+(.{3,200}?)[.;]/i, groups: { subject: 1, detail: 2 } },
  { kind: "CAUSE", re: /\b(.{3,80}?)\s+(?:causes?|caused by|leads? to|results? in|is responsible for|gives rise to)\s+(.{3,200}?)[.;]/i, groups: { subject: 1, detail: 2 } },
  { kind: "CAUSE", re: /(.{3,80}?)\s+(?:يسبب|تسبب في|يؤدي إلى)\s*(.{3,200}?)[.؛]/, groups: { subject: 1, detail: 2 } },
  { kind: "FEATURE", re: /\b(.{3,80}?)\s+(?:is characterized by|are characterized by|is characterized|features?|presents? with|manifests? as)\s+(.{3,200}?)[.;]/i, groups: { subject: 1, detail: 2 } },
  { kind: "FEATURE", re: /(.{3,80}?)\s+(?:يتميز بـ|يتصف بـ)\s*(.{3,200}?)[.؛]/, groups: { subject: 1, detail: 2 } },
  { kind: "CLASSIFICATION", re: /\b(.{3,80}?)\s+(?:is classified (?:as|in)to|are classified (?:as|in)to|can be classified|subtypes? (?:are|include)|is divided into)\s+(.{3,200}?)[.;]/i, groups: { subject: 1, detail: 2 } },
  { kind: "CLASSIFICATION", re: /(.{3,80}?)\s+(?:ينقسم إلى|تنقسم إلى|تصنف إلى)\s*(.{3,200}?)[.؛]/, groups: { subject: 1, detail: 2 } },
  // The trailing "because ..." clause is the useful part, so it is kept as detail.
  { kind: "COMPARISON", re: /\b(.{3,80}?)\s+(?:differs? from|is similar to|in contrast (?:to|with)|unlike|as opposed to)\s+(.{3,120}?)\s+(because|since|as|while|whereas)\s+(.{3,200}?)[.;]/i, groups: { subject: 1, counterpart: 2, detail: 4 } },
  { kind: "COMPARISON", re: /\b(.{3,80}?)\s+(?:differs? from|is similar to|unlike|as opposed to)\s+(.{3,120}?)(?:,|\.|$)/i, groups: { subject: 1, counterpart: 2 } },
  { kind: "COMPARISON", re: /(.{3,80}?)\s+(?:بخلاف|على عكس|بعكس)\s*(.{3,120}?)(?:،| لأن| حيث|[.؛]|$)/, groups: { subject: 1, counterpart: 2 } },
  { kind: "PURPOSE", re: /\b(.{3,80}?)\s+(?:is used to|are used to|is designed to|serves to|functions to|helps to)\s+(.{3,200}?)[.;]/i, groups: { subject: 1, detail: 2 } },
  { kind: "PURPOSE", re: /(.{3,80}?)\s+(?:يستخدم في|تستخدم في|وظيفته|غرضه)\s*(.{3,200}?)[.؛]/, groups: { subject: 1, detail: 2 } },
  { kind: "PROCESS", re: /\b(.{3,80}?)\s+(?:involves|consists of|comprises|occurs (?:in|through|when)|takes place)\s+(.{3,200}?)[.;]/i, groups: { subject: 1, detail: 2 } },
  { kind: "PROCESS", re: /(.{3,80}?)\s+(?:يتكون من|تتكوّن من|يشمل)\s*(.{3,200}?)[.؛]/, groups: { subject: 1, detail: 2 } },
  { kind: "DEFINITION", re: /\b(.{3,80}?)\s+(?:is|are)\s+defined as\s+(.{3,200}?)[.;]/i, groups: { subject: 1, detail: 2 } },
  { kind: "DEFINITION", re: /\b([A-Z][A-Za-z0-9'\- ]{2,70}?)\s+(?:is|are)\s+(?:a|an|the)?\s*(.{3,200}?)[.;]/, groups: { subject: 1, detail: 2 } },
  { kind: "DEFINITION", re: /(.{3,80}?)\s+(?:يُعرف بـ|معناه|يقصد به|هو:|تعني)\s*(.{3,200}?)[.؛]/, groups: { subject: 1, detail: 2 } },
];

/** Fallback: a leading capitalised term (EN) or a short leading phrase (AR). */
const LEADING_TERM_EN = /^([A-Z][A-Za-z0-9'\-]*(?:\s+[A-Z][A-Za-z0-9'\-]*){0,3})\b/;
const LEADING_TERM_AR = /^(.{3,60}?)\s+(?:هو|هي|يُعرف|تعرف|يتكون|تمثل|يتميز|يسبب|ينقسم|يستخدم)\b/;

const cleanFragment = (s: string): string =>
  s
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:،؛\-–—•*▪◦◆■]+/, "")
    .replace(/[\s,;:،؛\-–—•*▪◦◆■]+$/, "")
    .replace(/\s*\.\s*$/, "")
    .trim();

const LEADING_ARTICLE = /^(?:the|a|an|The|A|An)\s+/;

/**
 * Subjects that are sentence fragments rather than concepts.
 *
 * Real lecture text is extracted from PDFs and is full of dangling references
 * ("This", "They", "It"), headings ("Study", "Parts"), and fragments that begin
 * with a conjunction ("If the connection ..."). Treating those as terms
 * produced mind maps headed "This" and "They", which is worse than useless.
 */
const JUNK_SUBJECT = /^(?:this|that|these|those|it|they|he|she|we|you|there|here|such|one|some|many|most|all|both|each|every|another|other|study|part|parts|note|notes|example|examples|figure|table|summary|overview|introduction|conclusion|type|types|kind|kinds|group|groups|item|items|step|steps|important|main|key|first|second|third|also|however|therefore|thus|then|now|if|when|while|although|because|since|after|before|during|between|about|into|onto|from|with|without|within|under|over|above|below|because of|due to|as a|such as|in order|it is|there is|there are)\b/i;

const isJunkSubject = (s: string): boolean => {
  const t = s.trim();
  if (!t) return true;
  if (JUNK_SUBJECT.test(t)) return true;
  // Too short to be a real term, or purely numeric ("2 layers").
  if (t.replace(/\s+/g, " ").length < 4) return true;
  if (/^[\d\s.,%()-]+$/.test(t)) return true;
  // A subject that is mostly a stopword is not a concept.
  const words = normaliseForCompare(t).split(" ").filter(Boolean);
  if (!words.length) return true;
  if (words.every((w) => STOPWORDS.has(w))) return true;
  return false;
};

/**
 * A subject is only a usable term once the sentence-initial determiner is gone.
 * Without this, "The pericardium" produces the card front "What is The
 * pericardium?", which reads as broken English.
 */
const tidySubject = (s: string): string => cleanFragment(s).replace(LEADING_ARTICLE, "").trim();

const isUsable = (s: string): boolean =>
  s.length >= 3 && s.length <= 200 && /[\p{L}]/u.test(s) && !isJunkSubject(s);

/** Rejects a fragment that is just a number or filler. */
const isMeaningful = (s: string): boolean => {
  const t = normaliseForCompare(s);
  if (!t) return false;
  if (/^[\d\s.,%]+$/.test(t)) return false;
  return tokenise(s).length > 0;
};

export const extractFacts = (content: string, limit = 60): Fact[] => {
  const facts: Fact[] = [];
  for (const sentence of splitSentences(content)) {
    if (sentence.length < 25 || sentence.length > 420) continue;
    let matched = false;
    for (const rule of RULES) {
      const m = rule.re.exec(sentence);
      if (!m) continue;
      const subject = tidySubject(m[rule.groups.subject] ?? "");
      const detailIdx = rule.groups.detail;
      const counterpartIdx = rule.groups.counterpart;
      const rawDetail = detailIdx === undefined ? undefined : cleanFragment(m[detailIdx] ?? "");
      const counterpart = counterpartIdx === undefined ? undefined : cleanFragment(m[counterpartIdx] ?? "");
      if (!isUsable(subject)) continue;
      if (!matched && (!rawDetail || !isMeaningful(rawDetail)) && (!counterpart || !isMeaningful(counterpart))) continue;
      facts.push({
        kind: rule.kind,
        subject,
        detail: rawDetail && isMeaningful(rawDetail) ? rawDetail : "",
        counterpart: counterpart && isMeaningful(counterpart) ? counterpart : undefined,
        sentence: cleanFragment(sentence),
        weight: Math.min(1, sentence.length / 220),
      });
      matched = true;
      break;
    }
  }
  return deduplicate(facts, (f) => `${f.subject} ${f.detail} ${f.counterpart ?? ""}`, 0.8).slice(0, limit);
};

/** Subjects ranked by how much the lecture actually says about them. */
export const rankConcepts = (facts: Fact[]): ConceptNode[] => {
  const bySubject = new Map<string, ConceptNode>();
  const score = new Map<string, number>();
  for (const f of facts) {
    const key = normaliseForCompare(f.subject);
    if (!key) continue;
    let node = bySubject.get(key);
    if (!node) {
      node = { label: f.subject, detail: "", kind: f.kind, children: [] };
      bySubject.set(key, node);
      score.set(key, 0);
    }
    // Importance = how often the lecture elaborates on the concept, weighted by
    // how substantial the supporting statement is. Ranking by child count alone
    // promoted trivial terms into the top branches of the mind map.
    score.set(key, (score.get(key) ?? 0) + 0.5 + f.weight + (f.detail ? 0.6 : 0));
    const detail = f.detail || f.counterpart || "";
    if (detail && !node.detail) node.detail = detail;
    if (detail && node.children.length < 6) {
      const ck = normaliseForCompare(detail);
      if (!node.children.some((c) => normaliseForCompare(c.label) === ck)) {
        node.children.push({ label: detail, detail: "", kind: f.kind, children: [] });
      }
    }
  }
  return [...bySubject.values()].sort(
    (a, b) =>
      (score.get(normaliseForCompare(b.label)) ?? 0) - (score.get(normaliseForCompare(a.label)) ?? 0)
      || a.label.localeCompare(b.label),
  );
};

/* ------------------------------------------------------------------ */
/* summary                                                             */
/* ------------------------------------------------------------------ */

export type RichSummary = {
  overview: string;
  keyConcepts: Array<{ term: string; meaning: string }>;
  comparisons: Array<{ a: string; b: string; note: string }>;
  causes: Array<{ cause: string; effect: string }>;
  classifications: Array<{ group: string; members: string }>;
  takeaways: string[];
};

export const buildRichSummary = (facts: Fact[], fallbackOverview: string, lectureTitle: string): RichSummary => {
  const concepts = rankConcepts(facts);
  const keyConcepts = concepts
    .filter((c) => c.detail)
    .slice(0, 10)
    .map((c) => ({ term: c.label, meaning: trimDetail(c.detail) }));

  const comparisons = facts
    .filter((f) => f.kind === "COMPARISON" && f.counterpart)
    .slice(0, 5)
    .map((f) => ({ a: f.subject, b: f.counterpart!, note: trimDetail(f.detail) || f.sentence }));

  const causes = facts
    .filter((f) => f.kind === "CAUSE" && f.detail)
    .slice(0, 6)
    .map((f) => ({ cause: f.subject, effect: trimDetail(f.detail) }));

  const classifications = facts
    .filter((f) => f.kind === "CLASSIFICATION" && f.detail)
    .slice(0, 5)
    .map((f) => ({ group: f.subject, members: trimDetail(f.detail) }));

  const takeaways = facts
    .filter((f) => f.kind === "FEATURE" || f.kind === "PROCESS" || f.kind === "PURPOSE")
    .slice(0, 8)
    .map((f) => `${f.subject} — ${trimDetail(f.detail)}`);

  const overview = fallbackOverview?.trim()
    || (concepts.length
      ? `${lectureTitle} covers ${concepts.length} main concept${concepts.length === 1 ? "" : "s"}, led by ${concepts.slice(0, 3).map((c) => c.label).join(", ")}.`
      : `The source text for “${lectureTitle}” is too limited to build a structured summary.`);

  return { overview, keyConcepts, comparisons, causes, classifications, takeaways };
};

const trimDetail = (s: string): string => {
  const t = cleanFragment(s);
  return t.length > 220 ? `${t.slice(0, 217)}…` : t;
};

/* ------------------------------------------------------------------ */
/* mind map                                                            */
/* ------------------------------------------------------------------ */

export const buildMindMap = (facts: Fact[], lectureTitle: string, maxNodes = 8): ConceptNode => {
  const branches = rankConcepts(facts).slice(0, maxNodes);
  return {
    label: lectureTitle,
    detail: "",
    kind: "DEFINITION",
    children: branches.map((b) => ({
      ...b,
      children: b.children.slice(0, 5).map((c) => ({ ...c, children: [] })),
    })),
  };
};

/* ------------------------------------------------------------------ */
/* question intent                                                     */
/* ------------------------------------------------------------------ */

export type Intent =
  | "CAUSE"
  | "COMPARE"
  | "DEFINITION"
  | "LIST"
  | "SUMMARY"
  | "PROCESS"
  | "QUIZ"
  | "GENERAL";

const INTENT_PATTERNS: Array<[Intent, RegExp]> = [
  ["CAUSE", /\b(causes?|why|reason|due to|leads? to|results? in)\b|سبب|لماذا|بسبب|يؤدي|م什么原因/i],
  ["COMPARE", /\b(compare|difference|differs?|versus|vs\.?|similar|better than)\b|فرق|الفرق|مقارنة|بخلاف|أفضل|区别/i],
  ["DEFINITION", /\b(what is|define|definition|meaning of|what does .* mean)\b|ما هو|ما هي|عرّف|تعريف|معنى|من هو/i],
  ["PROCESS", /\b(how does|process|steps?|mechanism|sequence|how it works)\b|كيف|خطوات|آلية|مراحل|过程/i],
  ["LIST", /\b(list|enumerate|types?|kinds?|categories|classif)\b|اذكر|أنواع|انواع|تصنيف|قائمة/i],
  ["SUMMARY", /\b(summari[sz]e|summary|overview|tl;?dr|recap|main points?|key points?)\b|ملخص|ملخّص|لخّص|نظرة عامة/i],
  ["QUIZ", /\b(quiz|test me|exam|question|practice)\b|امتحان|اختبار|سؤال|أسئلة/i],
];

/** Resolves the student's intent, including a term they are asking about. */
export const detectIntent = (question: string): { intent: Intent; focusTerms: string[] } => {
  const focusTerms = extractQuotedOrCapitalised(question);
  for (const [intent, re] of INTENT_PATTERNS) {
    if (re.test(question)) return { intent, focusTerms };
  }
  return { intent: "GENERAL", focusTerms };
};

/** Pulls the term the question is about, e.g. "What causes X?" → X. */
export const extractQuotedOrCapitalised = (question: string): string[] => {
  const quoted = [...question.matchAll(/["“”']([^"“”']{3,70})["“”']/g)].map((m) => m[1].trim());
  if (quoted.length) return quoted;

  const caps = question.match(/\b([A-Z][A-Za-z0-9'\-]*(?:\s+[A-Z][A-Za-z0-9'\-]*){0,3})\b/g) ?? [];
  const filtered = caps
    .map((c) => c.trim())
    .filter((c) => c.length > 3 && !/^(What|Which|Where|When|Who|How|Why|Does|Is|Are|The|This|That|Explain|Summarise|Summarize|List|Define|Compare|Quiz|Test)$/i.test(c));
  if (filtered.length) return filtered;

  // Arabic: the phrase just before a question word.
  const ar = question.match(/(.{3,60}?)\s*(?:ما|من|لماذا|كيف|اذكر|قارن|عرّف|ما هو|ما هي)\b/);
  return ar ? [ar[1].trim()] : [];
};

/** Facts about a specific term, ranked by relevance. */
export const factsAbout = (facts: Fact[], terms: string[], intent: Intent, question = ""): Fact[] => {
  // When no clean term can be isolated, fall back to the question's own content
  // words. Without this, "What causes reduced cardiac output?" would return
  // nothing just because it contains no capitalised term or quotes.
  let keys = terms.map(normaliseForCompare).filter(Boolean);
  if (!keys.length) keys = tokenise(question).filter((t) => t.length > 3);
  if (!keys.length) return [];

  const scored = facts
    .map((f) => {
      const subj = normaliseForCompare(f.subject);
      const whole = normaliseForCompare(f.sentence);
      let score = 0;
      for (const k of keys) {
        if (subj === k) score += 6;
        else if (subj.includes(k) || k.includes(subj)) score += 3;
        else if (similarity(f.subject, k) > 0.5) score += 2;
        if (whole.includes(k)) score += 2;
        if (normaliseForCompare(f.detail).includes(k)) score += 1;
      }
      if (intent !== "GENERAL" && f.kind === intent) score += 2;
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return deduplicate(scored.map((x) => x.f), (f) => `${f.subject} ${f.detail}`, 0.8).slice(0, 5);
};
