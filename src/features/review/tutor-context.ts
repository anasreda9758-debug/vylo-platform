/**
 * Conversational referent resolution for the source-grounded tutor.
 *
 * Follow-up questions like "What causes it?" / "اشرح ده" carry no term of
 * their own. This module detects anaphoric questions and resolves the referent
 * against the most recently discussed topic from the chat history. When the
 * referent is genuinely ambiguous (no topic yet), the tutor asks a short
 * clarification question instead of inventing one.
 */

import { extractQuotedOrCapitalised } from "./source-analysis";

export type HistoryMessage = { role?: string; content?: string };

export type ResolvedFocus = {
  /** The topic resolved from history when the question is anaphoric. */
  focus: string | null;
  /** True when the question is anaphoric but no topic could be resolved. */
  wantsClarification: boolean;
};

/** English demonstrative/pronoun references. */
const EN_REF = /\b(it|this|that)\b/i;

/** Arabic standalone demonstratives and pronouns. */
const AR_REF = /(ده|دي|دا|ذا|ذِه|ذِي|هذا|هذه|ذلك|تلك|هو|هي)/u;

/** Arabic suffix pronouns on common medical/interrogative noun stems. */
const AR_SUFFIX = /(?:أسباب|اسباب|علاج|وظيفة|وظيفه|دور|مكونات|مكوّنات|خصائص|خصايص|أعراض|اعراض|أنواع|انواع|تركيب|بنية|تفاعل|آلية|الية|خواص|صورة|شكل|تكوين|بداية|نهاية|سبب)(ه|ها|هم)(?:[؟?.!]\s*|\s|$)/u;

/** Demonstrative directly after a copula: "ما هو ده؟" — still a referent. */
const AR_COPULA_REF = /^(?:ما هو|ما هي)\s*(هذا|هذه|ده|دي|دا|ذا|ذلك|تلك|هو|هي)\s*[؟?.!]?\s*$/u;

/**
 * Arabic object pronouns on a verb: "اوصفه" (describe it), "اشرحها" (explain
 * it).
 *
 * The guard is a negative lookahead rather than `\b`: `\b` is defined over
 * [A-Za-z0-9_], and a space next to an Arabic letter is not a word boundary, so
 * `\b` would make this rule dead. The lookahead also keeps "ما هو" out, because
 * the "ه" of "هو" is followed by another letter.
 */
const AR_VERB_REF =
  /^(?:اوصف|أوصف|إوصاف|تصف|اشرح|فسر|وضح|عرف|اذكر|بيّن|بين|ما)\s*(?:ل[يم]?[تك]?)?\s*(?:ه|ها|هم|هن|ذلك|هذه)(?![؀-ۿ])/u;

/**
 * True when the question references a previously-discussed topic instead of
 * naming a term of its own.
 */
export const isAnaphoric = (question: string): boolean => {
  const q = question.trim();
  if (!q) return false;

  // A question with its own quoted or capitalised term is self-contained.
  if (extractQuotedOrCapitalised(q).length > 0) return false;

  // "this lecture / this chapter" refers to the current material, not history.
  if (/\b(?:this|that)\s+(?:lecture|lesson|course|content|material|chapter|topic|section|text|module|slide)\b/i.test(q)) return false;

  // "ما هو ده؟" is anaphoric even though "هو" looks like a copula.
  if (AR_COPULA_REF.test(q)) return true;

  if (EN_REF.test(q)) return true;

  // "اوصفه" / "اشرحها" carry a pronoun on the verb.
  if (AR_VERB_REF.test(q)) return true;

  // Arabic referent, but never when "هو/هي" is a copula after "ما".
  const arMatch = q.match(AR_REF);
  if (arMatch && !/^(?:ما هو|ما هي)(?:\s|$)/.test(q)) return true;
  if (AR_SUFFIX.test(q)) return true;
  return false;
};

/** Extracts a concrete subject noun from a prior message, or null. */
export const subjectNoun = (content: string): string | null => {
  const en = content.match(
    /\b(?:what is|what are|what was|define|what causes|cause of|explain)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9'\-]*(?:\s+[A-Za-z][A-Za-z0-9'\-]*){0,4})/i,
  );
  if (en && !/\b(it|this|that)\b/i.test(en[1])) return en[1].replace(/[?.!]+$/, "").trim();
  const ar = content.match(
    /(?:ما هو|ما هي|عرّف|ماذا تعني|ما المقصود|اشرح)\s+([^\s؟?!.,،]+(?:\s+[^\s؟?!.,،]+){0,4})/u,
  );
  if (ar) {
    const term = ar[1].trim();
    if (AR_REF.test(term)) return null; // a demonstrative is not a topic
    return term;
  }
  return null;
};

const stripBoldLabel = (raw: string): string =>
  raw.replace(/\*\*/g, "").replace(/[:：].*$/, "").trim();

/**
 * Section labels a tutor reply can open with. They describe the shape of the
 * answer, never the concept, so they must not become the follow-up topic.
 */
const REPLY_SECTION_LABELS = new Set([
  "explanation",
  "key points",
  "key terms",
  "check yourself",
  "cause & effect",
  "cause and effect",
  "comparisons",
  "short answer",
  "summary",
  "الشرح",
  "أهم النقاط",
  "المصطلحات المهمة",
  "سؤال للمراجعة",
  "السبب والنتيجة",
  "مقارنات",
  "إجابة موجزة",
  "ملخص",
]);

const normaliseLabelKey = (s: string): string => s.replace(/^ال/, "").trim().toLowerCase();

/**
 * The topic line of a plain-text reply.
 *
 * The tutor writes the concept it is answering as its own first line
 * ("Acute pericarditis:"). Only that line qualifies, and only when it is not a
 * section label.
 */
const topicFromReply = (content: string): string | null => {
  const first = (content.split("\n").find((l) => l.trim()) ?? "").trim();
  if (!first || first.length > 70) return null;
  if (first.includes("\n")) return null;
  const label = stripBoldLabel(first);
  if (label.length < 2) return null;
  if (REPLY_SECTION_LABELS.has(normaliseLabelKey(label))) return null;
  if (label.split(/\s+/).length > 6) return null;
  // A full sentence is a fact, not a topic label.
  if (/[.!?،,;]\s*$/.test(label)) return null;
  return label;
};

/**
 * Finds the most recent topic from history.
 *
 * A tutor reply names the concept it is answering on its first line. Replies
 * written before the plain-text change used a bold header (`**Pericardium**`),
 * which is still read so existing chats keep working. Failing both, a named
 * term from an earlier user question is used.
 */
export const lastTopicFromHistory = (history: HistoryMessage[]): string | null => {
  const messages = history ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i]?.content ?? "";
    if (!content.trim()) continue;
    const role = (messages[i]?.role ?? "").toLowerCase();
    if (role === "assistant") {
      const fromReply = topicFromReply(content);
      if (fromReply) return fromReply;
      const bolds = content.match(/\*\*([^*]{2,70})\*\*/g) ?? [];
      if (bolds.length) {
        const label = stripBoldLabel(bolds[0] ?? "");
        if (label.length > 1 && !REPLY_SECTION_LABELS.has(normaliseLabelKey(label))) return label;
      }
    }
    const terms = extractQuotedOrCapitalised(content).filter(
      (t) => !REPLY_SECTION_LABELS.has(normaliseLabelKey(t)),
    );
    if (terms.length) return terms[0];
    const noun = subjectNoun(content);
    if (noun) return noun;
  }
  return null;
};

/**
 * Resolves an anaphoric question against history.
 *
 * When the question names its own term this returns immediately, so normal
 * questions are never touched. Only pronoun/demonstrative follow-ups resolve a
 * topic here; unresolved ones ask for clarification.
 */
export const resolveConversationalFocus = (
  question: string,
  history: HistoryMessage[],
): ResolvedFocus => {
  if (!isAnaphoric(question)) return { focus: null, wantsClarification: false };
  const focus = lastTopicFromHistory(history ?? []);
  if (!focus) return { focus: null, wantsClarification: true };
  return { focus, wantsClarification: false };
};