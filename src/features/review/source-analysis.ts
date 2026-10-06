/**
 * Deterministic source analysis for lecture-derived study material.
 *
 * The local fallback (no hosted model) must still be genuinely useful, so this
 * module extracts structured facts from the lecture text instead of echoing
 * raw sentences. It is fully deterministic and language-aware for English and
 * Arabic: nothing here invents a fact that is not present in the source.
 */

import { QUIZ_ITEM_RE, looksLikeReference, stripCitation } from "./source-signals";

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

const ABBREV =
  /\b(?:e\.g|i\.e|etc|vs|approx|Dr|Mr|Mrs|Ms|St|Fig|No|Lt|Rt|Cm|Mm|Kg|Mg|Dl|ml|mg|Ph)(?:\.)?$/i;

/**
 * A period that ends an abbreviation or sits inside brackets does not end a
 * sentence: "(Lt. ventricle, aorta)" is one statement, not two.
 */
const ENDS_SENTENCE = /(?<=[.!?؟…])\s+|\n+|(?:;(?=\s))/g;
const NOT_SENTENCE_END = /[([{«"]$/;

export const splitSentences = (content: string): string[] => {
  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  // Split on . ! ? and the Arabic equivalents, plus newlines/semicolons.
  const raw = flat
    .split(ENDS_SENTENCE)
    .map((s) => s.trim())
    .filter(Boolean);

  const merged: string[] = [];
  for (const piece of raw) {
    const prev = merged[merged.length - 1];
    if (prev && (ABBREV.test(prev) || NOT_SENTENCE_END.test(prev))) merged[merged.length - 1] = `${prev} ${piece}`;
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
  // Arabic copula definition: "التامور هو غشاء ليفي ...". Anchored at the start
  // of the sentence so a pronoun fragment ("وهو ...") cannot become a term.
  {
    kind: "DEFINITION",
    re: /^([\p{L}]{2,}(?:\s+[\p{L}]{2,}){0,3})\s+(?:هو|هي)\s+(.{3,200}?)\s*[.؛]/u,
    groups: { subject: 1, detail: 2 },
  },
];

/** Fallback: a leading capitalised term (EN) or a short leading phrase (AR). */
const LEADING_TERM_EN = /^([A-Z][A-Za-z0-9'\-]*(?:\s+[A-Z][A-Za-z0-9'\-]*){0,3})\b/;
const LEADING_TERM_AR = /^(.{3,60}?)\s+(?:هو|هي|يُعرف|تعرف|يتكون|تمثل|يتميز|يسبب|ينقسم|يستخدم)\b/;

// "The left ventricle pumps blood" names its subject in lower case after the
// article, so the capitalised-word pattern above cannot see it.
const LEADING_TERM_EN_ARTICLE = /^(?:[Tt]he|[Aa]n?)\s+([a-z][a-z'\-]*(?:\s+[a-z][a-z'\-]*)?)/;
// A verb after the subject ends the subject, so "left ventricle pumps" is the
// concept "left ventricle" and not "left ventricle pumps".
const EN_VERB_AFTER_SUBJECT =
  /^(?:pumps?|carries|carried|returns?|returned|enters?|supplies?|beats?|contracts?|receives?|sends?|contains?|forms?|allows?|connects?|separates?|drains?|passes|travels?|moves?|flows?|empties|fills?|differs?|consists?|includes?|occurs?|arises?|represents?|equals?|means?|refers?|results?|appears?|remains?|becomes?|shows?|gives?|takes?|uses?|requires?|acts?|serves?|causes?|produces?|affects?|carries)$/i;

/**
 * The subject a plain statement opens with, with the text left over once the
 * subject is removed, or null when the sentence names no usable subject.
 */
const statementSubject = (sentence: string): { subject: string; rest: string } | null => {
  const article = sentence.match(LEADING_TERM_EN_ARTICLE);
  if (article) {
    const words = article[1].split(/\s+/);
    // "The left ventricle pumps blood" keeps "pumps" in the detail.
    const head = words.length > 1 && EN_VERB_AFTER_SUBJECT.test(words[1]) ? words[0] : article[1];
    return { subject: head, rest: sentence.slice(article[0].length) };
  }
  const ar = sentence.match(LEADING_TERM_AR);
  if (ar) return { subject: ar[1], rest: sentence.slice(ar[0].length) };
  const en = sentence.match(LEADING_TERM_EN);
  if (en) {
    if (FUNCTION_WORD_HEAD.test(en[1])) return null;
    const grown = leadingTermWithContinuation(en[1], sentence.slice(en[0].length));
    return { subject: grown.subject, rest: stripSeparator(grown.rest) };
  }
  return null;
};

/** Function words that end a term rather than continue it. */
const TERM_BREAK_WORD =
  /^(?:of|in|on|at|by|for|to|from|with|as|and|or|but|so|than|then|that|which|who|when|while|if|because|is|are|was|were|be|been|has|have|had|do|does|did|can|could|will|would|should|may|might|must|not|no|their|its|his|her|our|your|they|these|this|these|into|over|under|between|among|per|via|composed|formed|made|known|called|based|due|there|part|one|such|including|using|used)$/i;

/**
 * A capitalised sentence-initial function word is not a term head: "In the
 * provided test, the copper-protein complex ..." starts a sentence, it does not
 * name a concept.
 */
const FUNCTION_WORD_HEAD =
  /^(?:in|on|at|by|for|from|with|as|and|or|but|so|than|then|that|this|these|those|when|while|if|because|since|after|before|during|through|upon|into|within|without|between|among|per|via|it|its|they|them|their|our|your|his|her|the|a|an|there|here|however|although|thus|therefore|hence)$/i;

/** "Blood pumped from the left" keeps "pumped" out of the term. */
const PARTICIPLE_TAIL = /(?:ed|ing)$/i;

/**
 * "Principle of the biuret method" is one term: a short prepositional phrase
 * continues the head noun instead of ending it.
 */
const TERM_BRIDGE = /^(?:of|for|in|on|to)$/i;
const DETERMINER = /^(?:the|a|an)$/i;

/**
 * A slide line capitalises only the first word ("Cytoplasmic membrane: ..."), so
 * the capitalised-word match alone leaves the head of the term in the detail.
 * Lowercase words continue the term until a verb or function word ends it.
 */
const leadingTermWithContinuation = (head: string, tail: string): { subject: string; rest: string } => {
  let subject = head;
  let rest = tail;
  let afterBridge = false;
  const words = (): number => subject.split(/\s+/).length;
  for (let i = 0; i < 5; i++) {
    const next = rest.match(/^\s+([a-z][a-z'\-]*)\b/);
    if (!next) break;
    const word = next[1];
    const take = (): void => {
      subject += ` ${word}`;
      rest = rest.slice(next![0].length);
    };
    if (TERM_BRIDGE.test(word)) {
      if (words() >= 4) break;
      take();
      afterBridge = true;
      continue;
    }
    if (DETERMINER.test(word)) {
      if (!afterBridge) break;
      take();
      afterBridge = false;
      continue;
    }
    if (EN_VERB_AFTER_SUBJECT.test(word) || TERM_BREAK_WORD.test(word)) break;
    if (PARTICIPLE_TAIL.test(word)) break;
    if (words() >= 5) break;
    take();
    afterBridge = false;
  }
  // The prepositional phrase belongs to the term only when the term is a label
  // ("Principle of the biuret method: ..."). Mid-sentence it is the next clause
  // ("Veins of the stomach & intestine instead of carrying ...").
  const bridged = { subject, rest };
  return /^\s*:/.test(bridged.rest) ? bridged : plainTermWithContinuation(head, tail);
};

const plainTermWithContinuation = (head: string, tail: string): { subject: string; rest: string } => {
  let subject = head;
  let rest = tail;
  for (let i = 0; i < 4; i++) {
    const next = rest.match(/^\s+([a-z][a-z'\-]*)\b/);
    if (!next) break;
    const word = next[1];
    if (TERM_BRIDGE.test(word) || DETERMINER.test(word)) break;
    if (EN_VERB_AFTER_SUBJECT.test(word) || TERM_BREAK_WORD.test(word)) break;
    if (PARTICIPLE_TAIL.test(word)) break;
    if (subject.split(/\s+/).length >= 5) break;
    subject += ` ${word}`;
    rest = rest.slice(next[0].length);
  }
  return { subject, rest };
};

/** "Subject: detail" leaves the colon in the detail. */
const stripSeparator = (rest: string): string => rest.replace(/^\s*[:\u2013\u2014-]+\s*/, "");

/**
 * A statement that no relation pattern matched, reduced to subject + detail.
 *
 * Extracted slide text is mostly plain statements ("The right ventricle pumps
 * blood into the pulmonary trunk") that match no CAUSE/DEFINITION pattern.
 * Discarding them left the summary with a handful of concepts for a 180-line
 * lecture, so the leading term carries the concept and the remainder the
 * meaning.
 */
const statementFact = (sentence: string): Fact | null => {
  if (sentence.length < 32) return null;
  // A question is not a fact, and neither is a clinical vignette.
  if (/[?؟]\s*$/.test(sentence)) return null;
  if (QUIZ_ITEM_RE.test(sentence)) return null;
  if (/\b(?:a|an)\s+\d{1,3}[- ]year[- ]old\b/i.test(sentence)) return null;

  const head = statementSubject(sentence);
  if (!head) return null;
  const subject = tidySubject(head.subject);
  if (!isUsable(subject)) return null;
  // A table row or a broken sentence yields "Types:1.direct cause" or "Differs
  // from", which name no concept.
  if (/\d/.test(subject)) return null;
  const subjectWords = subject.split(/\s+/);
  const lastWord = subjectWords[subjectWords.length - 1] ?? "";
  if (EN_VERB_AFTER_SUBJECT.test(lastWord)) return null;
  if (/(?:which|that|where|when|because|although|however)$/i.test(lastWord)) return null;
  // "Which", "What", "Regarding" lead a question, never a concept.
  if (/^(?:which|what|where|when|who|why|how|regarding|site|following|given|choose|select)\b/i.test(subject)) {
    return null;
  }

  const rest = cleanFragment(head.rest).replace(/^(?:هو|هي|is|are)\s+/i, "");
  if (rest.length < 12) return null;

  return {
    kind: "FEATURE",
    subject,
    detail: rest,
    sentence,
    weight: Math.min(1, sentence.length / 220),
  };
};

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

/**
 * Multiple-choice furniture ("Which of the following ...") is a question, not a
 * concept, so it must never become a summary term or mind-map branch.
 */
const MCQ_SUBJECT = /\b(?:which of the following|all of the above|none of the above|the following (?:is|are)|true or false|best describes|is incorrect|is false|is true)\b/i;

/** Bibliography/metadata wording that must never become a study term. */
const NON_STUDY_SUBJECT =
  /\b(?:press|publishers?|edition|ed\.|references?|bibliography|department|faculty|university|college|staff members?|learning outcomes?|objectives?|isbn|doi)\b/i;

/**
 * A concept is a noun phrase. A "subject" carrying a finite verb, or a dangling
 * possessive, is a clause lifted out of a slide or an OCR table cell
 * ("Valves No valves Have valves They", "Their lumen"), and it makes a poor
 * summary term and a worse mind-map branch.
 */
const CLAUSE_SUBJECT = /\b(?:is|are|was|were|has|have|had|do|does|did|can|could|will|would|should|must|contains?|carries|carry|consists?|lies?|makes?)\b/i;
const CLAUSE_SUBJECT_AR =
  /(?:\bهو\b|\bهي\b|\bيكون\b|\bتكون\b|\bيسبب\b|\bتسبب\b|\bيحتوي\b|\bتحتوي\b|\bينقسم\b|\bينتج\b|\bيمثل\b|\bيستخدم\b)/u;

/**
 * A subject ending in a function word ("determination of", "Composed of
 * peptidoglycan which") is a clause with its head cut off, not a term.
 */
const DANGLING_TAIL = /\b(?:of|the|a|an|and|or|to|for|with|in|on|at|by|from|that|which|as|is|are|was|were|its|their|into|over|under|between|among|than|then|such|these|this|these|into|upon|within|via|per)$/i;

/**
 * A subject starting with a participle or a subordinator ("Composed of ...",
 * "Based on ...", "There are ...") never names the thing being described.
 */
const PHRASE_LEAD =
  /^(?:composed|consists?|consisting|made|called|known|due|based|because|there|part|one|such|including|given|taken|obtained|resulting|according|since|if|when|while|although|after|before|during|through|upon|within|without|between|among|over|under|above|below|per|via|has|have|had|it|its)\b/i;

/**
 * A practical writes its method as imperatives ("Add a few drops of reagent").
 * The step is content, but it does not name a concept.
 */
const IMPERATIVE_HEAD =
  /^(?:add|use|place|take|put|mix|stir|heat|cool|read|record|note|observe|allow|incubate|wash|rinse|dry|transfer|pipette|measure|repeat|check|apply|insert|remove|store|leave|avoid|keep|hold|fill|empty|wait|start|stop|prepare|calculate|plot|draw|label|ensure|look|compare|list|write|draw|draw|test|drop|turn|press|pour|melt|filter|weigh|count|review|discuss|define|draw)\b/i;

const isJunkSubject = (s: string): boolean => {
  const t = s.trim();
  if (!t) return true;
  if (JUNK_SUBJECT.test(t)) return true;
  if (MCQ_SUBJECT.test(t)) return true;
  if (NON_STUDY_SUBJECT.test(t)) return true;
  if (CLAUSE_SUBJECT.test(t)) return true;
  if (CLAUSE_SUBJECT_AR.test(t)) return true;
  if (DANGLING_TAIL.test(t)) return true;
  if (PHRASE_LEAD.test(t)) return true;
  if (IMPERATIVE_HEAD.test(t)) return true;
  // Possessives and bare pronouns that survived the list above.
  if (/^(?:their|its|his|her|our|your|their's|them|they|these|those|he|she)\b/i.test(t)) return true;
  if (t.split(/\s+/).length > 7) return true;
  if (looksLikeReference(t)) return true;  // Too short to be a real term, or purely numeric ("2 layers").
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
  for (const rawSentence of splitSentences(content)) {
    // A citation suffix is not knowledge: "The heart acts as a pump (Snell,
    // 2008)" must yield the medical claim without the reference.
    const sentence = stripCitation(rawSentence).trim();
    if (sentence.length < 25 || sentence.length > 420) continue;
    // The same shared filter the cleaner uses: a bibliography, affiliation or
    // objective line never becomes a study fact, even if it survived cleaning
    // inside a larger block of text.
    if (looksLikeReference(sentence)) continue;
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
    if (matched) continue;

    // A statement no relation pattern recognised is still study content. Its
    // leading term becomes the subject and the rest the detail, so a lecture
    // written as plain statements still produces a usable summary instead of a
    // two-item one.
    const fallback = statementFact(cleanFragment(sentence));
    if (fallback) facts.push(fallback);
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

/** A child label must read as a short phrase, not as a clipped sentence. */
const mindMapChildLabel = (text: string): string => {
  const t = cleanFragment(text.replace(/^[\s•*▪◦◆■❖➢✓-]+/, ""));
  if (!t) return "";
  const words = t.split(/\s+/);
  if (words.length <= 9) return t;
  return `${words.slice(0, 9).join(" ")}…`;
};

/**
 * Builds the lecture mind map.
 *
 * Branches are the lecture's own ranked concepts, each with the facts stated
 * about it, because a section title cannot be tied to facts reliably from
 * plain extracted text: a title such as "Heart" shares a word with nearly
 * every sentence, which produced branches that repeated the same child.
 */
export const buildMindMap = (facts: Fact[], lectureTitle: string, maxNodes = 8): ConceptNode => {
  const branches = rankConcepts(facts).slice(0, maxNodes);
  return {
    label: lectureTitle,
    detail: "",
    kind: "DEFINITION",
    children: branches.map((b) => ({
      ...b,
      children: b.children
        .slice(0, 5)
        .map((c) => ({ ...c, label: mindMapChildLabel(c.label) || c.label, children: [] }))
        .filter((c) => c.label.length > 0),
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
  ["CAUSE", /\b(causes?|why|reason|due to|leads? to|results? in)\b|سبب|لماذا|بسبب|يؤدي/i],
  ["COMPARE", /\b(compare|difference|differs?|versus|vs\.?|similar|better than)\b|فرق|الفرق|مقارنة|بخلاف|أفضل/i],
  // A request for a list wins over a definition: "ما هي أنواع التهاب التامور؟"
  // asks for kinds, not for a single meaning.
  ["LIST", /\b(list|enumerate|types?|kinds?|categories|classif)\b|اذكر|أنواع|انواع|تصنيف|قائمة/i],
  // "اوصفه باختصار" / "اشرحه ببساطة" ask for a definition, not a lecture dump.
  [
    "DEFINITION",
    /\b(what is|define|definition|meaning of|what does .* mean|describe|explain)\b|ما هو|ما هي|عرّف|عرف|تعريف|معنى|من هو|اوصف|إوصاف|وصف|باختصار|بشكل مبسط|ببساطة/i,
  ],
  ["PROCESS", /\b(how does|process|steps?|mechanism|sequence|how it works)\b|كيف|خطوات|آلية|مراحل/i],
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
