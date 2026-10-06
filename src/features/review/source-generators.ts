import {
  extractFacts, buildRichSummary, detectIntent, extractQuotedOrCapitalised, factsAbout,
  rankConcepts, normaliseForCompare, deduplicate, type Fact, type RichSummary, type ConceptNode,
} from "./source-analysis";
import { cleanedSource } from "./source-cleaner";
import { resolveConversationalFocus, subjectNoun, type HistoryMessage } from "./tutor-context";

type Summary = {
  overview?: string;
  keyPoints?: string[];
  clinicalPearls?: string[];
  richSummary?: RichSummary;
  mindMap?: ConceptNode;
} | null;

/** Existing stored summary (legacy shape). */
type LegacySummary = { overview?: string; keyPoints?: string[]; clinicalPearls?: string[] } | null;

const legacy = (summary: Summary | LegacySummary): LegacySummary =>
  summary && "keyPoints" in summary ? (summary as LegacySummary) : null;

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* flashcards                                                          */
/* ------------------------------------------------------------------ */

export type CardType = "DEFINITION" | "CAUSE_EFFECT" | "COMPARE" | "IDENTIFICATION" | "LIST" | "CLOZE";

export type SourceCard = {
  front: string;
  back: string;
  cardType: CardType;
};

/** Every card asks a genuinely different question about different content. */
const cardForFact = (fact: Fact, ar: boolean): SourceCard | null => {
  const subject = clean(fact.subject);
  const detail = clean(fact.detail);
  const counterpart = fact.counterpart ? clean(fact.counterpart) : "";

  switch (fact.kind) {
    case "DEFINITION":
      if (!detail) return null;
      return {
        cardType: "DEFINITION",
        front: ar ? `ما هو ${subject}؟` : `What is ${subject}?`,
        back: detail,
      };
    case "CAUSE":
      if (!detail) return null;
      return {
        cardType: "CAUSE_EFFECT",
        front: ar ? `ما السبب الذي يؤدي إلى ${detail}؟` : `What causes ${detail}?`,
        back: ar ? `${subject} يؤدي إلى ${detail}.` : `${subject} causes ${detail}.`,
      };
    case "COMPARISON":
      if (!counterpart) return null;
      return {
        cardType: "COMPARE",
        front: ar ? `ما الفرق بين ${subject} و${counterpart}؟` : `How does ${subject} differ from ${counterpart}?`,
        back: ar
          ? `${subject} يختلف عن ${counterpart}${detail ? ` — ${detail}` : ""}.`
          : `${subject} differs from ${counterpart}${detail ? ` — ${detail}` : ""}.`,
      };
    case "CLASSIFICATION":
      if (!detail) return null;
      return {
        cardType: "LIST",
        front: ar ? `ما أنواع ${subject}؟` : `What are the types of ${subject}?`,
        back: detail,
      };
    case "FEATURE":
      if (!detail) return null;
      return {
        cardType: "IDENTIFICATION",
        front: ar ? `ما الذي يميز ${subject}؟` : `Which feature identifies ${subject}?`,
        back: detail,
      };
    case "PROCESS":
    case "PURPOSE":
      if (!detail) return null;
      return {
        cardType: "IDENTIFICATION",
        front: ar ? `ما دور ${subject}؟` : `What is the role of ${subject}?`,
        back: detail,
      };
    default:
      return null;
  }
};

/** A recall-style card that hides the most informative words. */
const clozeCard = (sentence: string, ar: boolean): SourceCard | null => {
  const words = clean(sentence).split(" ");
  if (words.length < 10) return null;
  const hideFrom = Math.floor(words.length * 0.5);
  const tail = words.slice(hideFrom);
  const answer = tail.join(" ");
  if (answer.length < 25 || answer.length > 180) return null;
  const stem = words.slice(0, hideFrom).join(" ");
  return {
    cardType: "CLOZE",
    front: ar ? `أكمل: ${stem} ………` : `Complete: ${stem} ………`,
    back: answer,
  };
};

const warnIfWeak = (cards: SourceCard[], content: string): string | null => {
  if (cards.length >= 3) return null;
  if (!content || content.replace(/\s+/g, " ").trim().length < 200) {
    return "This lecture has too little text to build reliable cards. Add richer lecture notes or the full PDF, then try again.";
  }
  return `Only ${cards.length} structured fact${cards.length === 1 ? "" : "s"} could be extracted from this lecture, so few cards were generated.`;
};

export type FlashcardResult = { cards: SourceCard[]; warning: string | null };

/** Free, source-grounded flashcards with varied, non-repetitive card types. */
export function createSourceFlashcards(title: string, content: string, summary: Summary): FlashcardResult {
  const source = cleanedSource(content ?? "", { title });
  const ar = /[\u0600-\u06FF]/.test(source);
  const facts = extractFacts(source, 40);
  const fromFacts = facts
    .map((f) => cardForFact(f, ar))
    .filter((c): c is SourceCard => c !== null);

  // Semantic dedup on the question text, so the same concept never produces
  // several near-identical prompts.
  let cards = deduplicate(fromFacts, (c) => `${c.front} ${c.back}`, 0.62);

  if (cards.length < 6) {
    const clozes = facts.map((f) => clozeCard(f.sentence, ar)).filter((c): c is SourceCard => c !== null);
    cards = deduplicate([...cards, ...clozes], (c) => `${c.front} ${c.back}`, 0.62);
  }

  const trimmed = cards.slice(0, 12);
  return { cards: trimmed, warning: warnIfWeak(trimmed, source) };
}

/* ------------------------------------------------------------------ */
/* clinical case                                                       */
/* ------------------------------------------------------------------ */

export type SourceCase = {
  case: string;
  questions: string[];
  model_answers: string[];
};

/**
 * A source-grounded study case. The scenario is built from the lecture's own
 * concepts instead of a meta instruction, and each question targets one
 * specific fact so answers are actually gradeable.
 */
export function createSourceClinicalCase(title: string, content: string, summary: Summary): SourceCase {
  const source = cleanedSource(content ?? "", { title });
  const ar = /[\u0600-\u06FF]/.test(source);
  const facts = extractFacts(source, 24);
  const concepts = rankConcepts(facts).filter((c) => c.detail).slice(0, 4);

  if (!concepts.length) {
    return {
      case: ar
        ? `لا يوجد محتوى نصي كافٍ في محاضرة "${title}" لبناء حالة سريرية موثوقة. أضف ملاحظات أو النص الكامل للمحاضرة ثم أعد المحاولة.`
        : `There is not enough source text in “${title}” to build a reliable case. Add the lecture notes or full text, then try again.`,
      questions: [],
      model_answers: [],
    };
  }

  const [primary, ...rest] = concepts;
  const focus = concepts.map((c) => c.label).join(", ");
  const scenario = ar
    ? `طالب في مقرر "${title}" يدرس ${focus}. راجع المفاهيم التالية ثم أجب عن الأسئلة.`
    : `A student revising “${title}” is working through ${focus}. Read the material, then answer the questions below.`;

  const questions = concepts.map((c) => {
    const fact = facts.find((f) => normaliseForCompare(f.subject) === normaliseForCompare(c.label));
    switch (fact?.kind) {
      case "CAUSE":
        return ar ? `ما السبب المؤدي إلى ${c.detail}؟` : `What leads to ${c.detail}?`;
      case "COMPARISON":
        return ar ? `كيف يختلف ${c.label} عن ${fact?.counterpart}؟` : `How does ${c.label} differ from ${fact?.counterpart}?`;
      case "CLASSIFICATION":
        return ar ? `اذكر أنواع ${c.label}.` : `List the types of ${c.label}.`;
      case "FEATURE":
        return ar ? `ما الذي يميز ${c.label}؟` : `What feature identifies ${c.label}?`;
      default:
        return ar ? `عرّف ${c.label}.` : `Define ${c.label}.`;
    }
  });

  const model_answers = concepts.map((c) => `${c.label}: ${c.detail}`);

  return { case: `${scenario}\n\n${rest.length ? "" : ""}`.trim(), questions, model_answers };
}

/* ------------------------------------------------------------------ */
/* tutor                                                               */
/* ------------------------------------------------------------------ */

const bullet = (s: string) => `• ${s}`;

/**
 * Answers the student's actual question from the source instead of echoing
 * sentences. Intent-aware: "what causes X" gets causes, "compare A and B" gets
 * the contrast, "what is X" gets the definition.
 *
 * An optional conversation history lets follow-up questions ("what causes it?",
 * "اشرح ده") resolve their subject against the most recently discussed topic.
 */
export function createSourceTutorReply(
  title: string,
  content: string,
  summary: Summary,
  question: string,
  context?: { history?: HistoryMessage[] },
): string {
  const source = cleanedSource(content ?? "", { title });
  const ar = /[\u0600-\u06FF]/.test(question ?? "");
  const facts = extractFacts(source, 40);

  const { focus, wantsClarification } = resolveConversationalFocus(question ?? "", context?.history ?? []);
  if (wantsClarification) {
    return ar
      ? "لم أتمكن من تحديد المصطلح المقصود في سؤالك. اذكر اسم المفهوم الذي تريد مناقشته (مثال: «اشرح التامور») ثم أعد السؤال."
      : "I couldn’t tell which topic you mean. Name the concept you want to discuss (e.g. “Explain the pericardium”), then ask again.";
  }

  const { intent, focusTerms } = detectIntent(question ?? "");
  // "What is acute pericarditis?" names its term in lower case, so capitalised
  // detection finds nothing; the noun after the question word is the real term.
  const namedTerm = focusTerms.length ? null : subjectNoun(question ?? "");
  // "ما هي أنواع التهاب التامور؟" asks about the condition, not about the word
  // "types", so the list word is not part of the term.
  const stripListWord = (t: string): string => {
    const stripped = t
      .replace(/^(?:أنواع|انواع|نوع|انواع من)\s+(?:من|of)?\s*/u, "")
      .replace(/^(?:types?|kinds?|categories|forms?)\s+(?:of)?\s*/i, "")
      .trim();
    return stripped.length > 2 ? stripped : t;
  };
  const effectiveTerms = (
    focusTerms.length
      ? focusTerms
      : namedTerm
        ? [namedTerm]
        : focus
          ? [focus]
          : []
  )
    .map(stripListWord)
    .filter(Boolean);
  const focused = factsAbout(facts, effectiveTerms, intent, question ?? "");

  // The tutor panel renders the reply as plain text, so labels must not carry
  // markdown syntax: a literal "**" is what a student sees.
  const L = ar
    ? {
        explain: "الشرح:",
        key: "أهم النقاط:",
        terms: "المصطلحات المهمة:",
        q: "سؤال للمراجعة:",
        none: "هذه المعلومة غير متوفرة في محتوى المحاضرة الحالية.",
        short: "إجابة موجزة",
        summaryTitle: `ملخص "${title}"`,
        cause: "السبب والنتيجة:",
        compare: "مقارنات:",
      }
    : {
        explain: "Explanation:",
        key: "Key points:",
        terms: "Key terms:",
        q: "Check yourself:",
        none: "This point is not covered in the current lecture material.",
        short: "Short answer",
        summaryTitle: `Summary of “${title}”`,
        cause: "Cause & effect:",
        compare: "Comparisons:",
      };

  if (intent === "SUMMARY") {
    const rich = summary?.richSummary ?? buildRichSummary(facts, legacy(summary)?.overview ?? "", title);
    const lines: string[] = [L.summaryTitle, "", rich.overview];
    if (rich.keyConcepts.length) {
      lines.push("", L.key);
      for (const c of rich.keyConcepts.slice(0, 6)) lines.push(bullet(`${c.term} — ${c.meaning}`));
    }
    if (rich.causes.length) {
      lines.push("", L.cause);
      for (const c of rich.causes.slice(0, 4)) lines.push(bullet(ar ? `${c.cause} ← ${c.effect}` : `${c.cause} → ${c.effect}`));
    }
    if (rich.comparisons.length) {
      lines.push("", L.compare);
      for (const c of rich.comparisons.slice(0, 3)) lines.push(bullet(ar ? `${c.a} مقابل ${c.b}` : `${c.a} vs ${c.b}`));
    }
    return lines.join("\n");
  }

  if (!facts.length) {
    return L.none;
  }

  // A term the student named that this lecture never mentions must be reported
  // as such. Answering with whatever matched weakly is what made "describe the
  // pericardium" in a cardiovascular lecture reply about the ventricles.
  const sourceKey = normaliseForCompare(source);
  // Matched on the term's own words rather than the whole phrase: a slide writes
  // "4 chambers: the 2 atria ..." and never the phrase "chambers of the heart"
  // the student typed.
  const GRAMMAR_WORDS =
    /^(?:what|which|where|when|who|why|how|is|are|was|were|the|a|an|of|in|on|for|with|from|to|and|or|do|does|did|that|this|these|those|it|its|about|tell|me|us|you|please|can|could|would|should)$/;
  const termAppears = (t: string): boolean => {
    const key = normaliseForCompare(t);
    if (!key) return false;
    if (sourceKey.includes(key)) return true;
    return t
      .split(/\s+/)
      .map((w) => normaliseForCompare(w))
      .some((w) => w.length >= 4 && !GRAMMAR_WORDS.test(w) && sourceKey.includes(w));
  };
  const namedOutsideLecture = effectiveTerms.filter((t) => !termAppears(t));
  if (effectiveTerms.length && namedOutsideLecture.length === effectiveTerms.length) {
    const covered = rankConcepts(facts)
      .slice(0, 4)
      .map((c) => c.label);
    return [
      ar
        ? `المصطلح "${effectiveTerms[0]}" غير مذكور في محاضرة "${title}".`
        : `"${effectiveTerms[0]}" is not covered in the lecture "${title}".`,
      "",
      ar ? `تغطي هذه المحاضرة: ${covered.join("، ")}.` : `This lecture covers: ${covered.join(", ")}.`,
    ].join("\n");
  }

  // Answer from the facts that are actually about the asked term, ranked by
  // relevance. Term relevance comes first and the relation the student asked
  // about only re-orders that short list: preferring a well-matching fact of
  // another kind is what made "what is pericarditis" answer with the
  // pericardium.
  const topFocused = focused.slice(0, 4);
  const isAboutTerm = (f: Fact): boolean =>
    effectiveTerms.some((t) => {
      const key = normaliseForCompare(t);
      const subj = normaliseForCompare(f.subject);
      return !!key && (subj === key || subj.includes(key) || key.includes(subj));
    });
  // A fact whose subject *is* the asked term outranks one that merely contains
  // it ("التامور" must win over "التهاب التامور الحاد").
  const onTerm = topFocused.filter(isAboutTerm).sort((a, b) => {
    const exact = (f: Fact): number =>
      effectiveTerms.some((t) => normaliseForCompare(f.subject) === normaliseForCompare(t)) ? 0 : 1;
    return exact(a) - exact(b);
  });
  const aboutTerm = onTerm.length ? onTerm : topFocused;
  const wanted = intent === "GENERAL" ? [] : aboutTerm.filter((f) => f.kind === intent);
  const answerPool = (wanted.length ? wanted : aboutTerm.length ? aboutTerm : facts).slice(0, 4);

  const labelFor = (kind: Fact["kind"]): string => {
    if (ar) {
      return { CAUSE: "السبب", COMPARISON: "المقارنة", DEFINITION: "التعريف", CLASSIFICATION: "التصنيف", FEATURE: "الخاصية", PROCESS: "الآلية", PURPOSE: "الغرض" }[kind];
    }
    return { CAUSE: "Cause", COMPARISON: "Contrast", DEFINITION: "Definition", CLASSIFICATION: "Classification", FEATURE: "Key feature", PROCESS: "Mechanism", PURPOSE: "Purpose" }[kind];
  };

  /** Renders one fact as a readable sentence, never as "subject cause — detail". */
  const phrase = (f: Fact): string => {
    if (f.kind === "COMPARISON" && f.counterpart) {
      return ar
        ? `${f.subject} يختلف عن ${f.counterpart}${f.detail ? `، ${f.detail}` : ""}.`
        : `${f.subject} differs from ${f.counterpart}${f.detail ? ` — ${f.detail}` : ""}.`;
    }
    const d = f.detail;
    if (!d) return "";
    // "Chambers is characterised by carry oxygenated blood" is not English: when
    // the detail is already a predicate, present the pair instead of a template.
    const startsWithVerb = /^(?:is|are|was|were|has|have|carries|carry|carrying|contains|contain|pumps?|pump|returns?|supplies?|receives?|sends?|forms?|occurs?|causes?|produces?|acts?|serves?|means?|refers?|lies?|extend|surround|surrounds|separates?|flows?|which|that|it|they|he|she|there|these|those)\b/i.test(d);
    if (startsWithVerb) return ar ? `${f.subject}: ${d}.` : `${f.subject} — ${d}.`;
    switch (f.kind) {
      case "CAUSE":
        return ar ? `${f.subject} يسبب ${d}.` : `${f.subject} causes ${d}.`;
      case "CLASSIFICATION":
        return ar ? `${f.subject} يُصنّف إلى: ${d}.` : `${f.subject} is classified into: ${d}.`;
      case "FEATURE":
        return ar ? `${f.subject} يتميّز بـ ${d}.` : `${f.subject} is characterised by ${d}.`;
      case "PURPOSE":
        return ar ? `${f.subject} يُستخدم في ${d}.` : `${f.subject} is used to ${d}.`;
      case "PROCESS":
        return ar ? `آلية ${f.subject} تقوم على ${d}.` : `${f.subject} involves ${d}.`;
      default:
        return ar ? `${f.subject}: ${d}.` : `${f.subject} — ${d}.`;
    }
  };

  const lines: string[] = [];
  const focusLabel = effectiveTerms[0];

  if (focusLabel) {
    lines.push(ar ? `${focusLabel}:` : focusLabel);
    lines.push("");
  }
  lines.push(L.explain);
  // Stay on the asked relation. Falling back to unrelated facts mid-answer is
  // the "why did it list random headings" complaint.
  const onTopic = intent === "GENERAL" ? answerPool : answerPool.filter((f) => f.kind === intent || f.detail);
  for (const f of (onTopic.length ? onTopic : answerPool)) {
    const text = phrase(f);
    if (text) lines.push(text);
  }

  // Extra facts are only padding for an open question. When the student asked
  // about one term, unrelated lecture lines are noise, not help.
  const shown = new Set(answerPool.map((f) => `${f.subject}|${f.detail}`));
  const others = facts
    .filter((f) => f.detail && !shown.has(`${f.subject}|${f.detail}`))
    .slice(0, 3);
  if (!effectiveTerms.length && others.length >= 2) {
    lines.push("", L.key);
    for (const f of others) lines.push(bullet(`${f.subject}: ${f.detail}`));
  }

  const termLine = facts.find((f) => f.kind === "DEFINITION" && f.detail && !answerPool.includes(f));
  if (termLine && !effectiveTerms.length) {
    lines.push("", L.terms, bullet(`${termLine.subject} = ${termLine.detail}`));
  }

  if (intent === "QUIZ") {
    const target = answerPool[0] ?? facts[0];
    if (target) {
      lines.push("", L.q, ar
        ? `ما الذي يصف ${target.subject} بدقة؟`
        : `Which statement best describes ${target.subject}?`);
      lines.push(ar ? `الإجابة: ${target.detail || target.sentence}` : `Answer: ${target.detail || target.sentence}`);
    }
  }

  return lines.join("\n").trim();
}

/* ------------------------------------------------------------------ */
/* evaluation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Grades free-text answers by concept coverage rather than exact word overlap,
 * so a correct answer in different wording still scores well.
 */
export function evaluateSourceAnswers(answers: string[], modelAnswers: string[]): { score: number; feedback: string } {
  const answer = (answers ?? []).join(" ").toLowerCase();
  if (!answer.trim() || !modelAnswers?.length) {
    return {
      score: 0,
      feedback: "No answer was provided. Write your answer and submit it again.",
    };
  }

  const total = modelAnswers.reduce((sum, m) => {
    const key = m.split(":")[0]?.trim() ?? m;
    const words = new Set(
      normaliseForCompare(key).split(" ").filter((w) => w.length > 3),
    );
    if (!words.size) return sum;
    let hits = 0;
    for (const w of words) if (answer.includes(w)) hits++;
    return sum + hits / words.size;
  }, 0);

  const score = Math.min(100, Math.round((total / modelAnswers.length) * 100));

  const feedback =
    score >= 80
      ? "Strong answer. You covered the key concept from the lecture source."
      : score >= 50
        ? "Partially correct. Name the specific concept from the lecture, then explain it."
        : "This does not match the lecture source. Re-read the relevant section and name the key concept explicitly.";

  return { score, feedback };
}
