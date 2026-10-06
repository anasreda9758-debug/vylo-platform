import type { QuestionKind, ExtractedQuestion, ExtractedOption, Traceability } from "./types";

let nextId = 0;
function qid(): string {
  return `q_${Date.now().toString(36)}_${(nextId++).toString(36)}`;
}

interface Line {
  text: string;
  trimmed: string;
}

function linesOf(text: string): Line[] {
  return text.split("\n").map((t) => ({ text: t, trimmed: t.trim() })).filter((l) => l.trimmed.length > 0);
}

function findNumberStructures(pageText: string): Array<{ label: string; number: number }> {
  const results: Array<{ label: string; number: number }> = [];
  const pattern = /(\d+)\s*\?\s*([A-Z][a-zA-Z .,'-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(pageText)) !== null) {
    const number = parseInt(m[1], 10);
    const label = m[2].trim();
    if (number > 0 && label.length > 0) {
      results.push({ label, number });
    }
  }
  return results;
}

export interface ClassifyResult {
  questions: ExtractedQuestion[];
  unparseablePages: number[];
}

export function classifyPage(pageText: string, sourcePdf: string, sourcePage: number): ClassifyResult {
  const questions: ExtractedQuestion[] = [];
  const joined = pageText;

  const structures = findNumberStructures(joined);
  for (const s of structures) {
    questions.push(makeQuestion("IMAGE_IDENTIFY_STRUCTURE", `Identify structure number ${s.number}.`, [makeOption(s.label, "pdf")], s.label, sourcePdf, sourcePage));
  }

  const parts = joined.split(/Identify the structure related to this area:/gi);
  const labels: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].trim();
    if (seg.length > 0) labels.push(seg);
  }
  if (labels.length >= 2) {
    questions.push(makeQuestion("IMAGE_RELATED_STRUCTURE", "Identify the structure related to this area.", labels.map((l) => makeOption(l, "pdf")), labels[0], sourcePdf, sourcePage));
  }

  const mcq = classifyMcq(joined, sourcePdf, sourcePage);
  if (mcq) questions.push(...mcq.questions);

  const diagnosis = classifyDiagnosis(joined, sourcePdf, sourcePage);
  if (diagnosis) questions.push(...diagnosis.questions);

  // Additional real-OSEP phrasings observed in module 1/IBL/RESP/module 2.
  const labeledStructures = joined.split(/Identify the labeled structure:/gi);
  const lsLabels: string[] = [];
  for (let i = 1; i < labeledStructures.length; i++) {
    const seg = labeledStructures[i].trim().split("\n")[0].trim();
    if (seg.length > 0) lsLabels.push(seg);
  }
  if (lsLabels.length >= 1) {
    questions.push(makeQuestion("IMAGE_IDENTIFY_STRUCTURE", "Identify the labeled structure.", lsLabels.map((l) => makeOption(l, "pdf")), lsLabels[0], sourcePdf, sourcePage));
  }

  const thisMatches = joined.match(/Identify This ([A-Za-z ]+)/gi);
  if (thisMatches && thisMatches.length >= 1) {
    const label = thisMatches[0].replace(/Identify This /i, "").trim();
    if (label.length > 0) {
      questions.push(makeQuestion("IMAGE_IDENTIFY_STRUCTURE", `Identify This ${label}.`, [makeOption(label, "pdf")], label, sourcePdf, sourcePage));
    }
  }

  const partMatches = joined.match(/Identify the labeled part of this ([A-Za-z ]+)/gi);
  if (partMatches && partMatches.length >= 1) {
    const label = partMatches[0].replace(/Identify the labeled part of this /i, "").trim();
    if (label.length > 0) {
      questions.push(makeQuestion("IMAGE_IDENTIFY_PART", `Identify the labeled part of this ${label}.`, [makeOption(label, "pdf")], label, sourcePdf, sourcePage));
    }
  }

  const labPatterns = [/(Identify the organism|acid-fast|gram stain|Gram stain)/i];
  for (const pat of labPatterns) {
    const m = pat.exec(joined);
    if (m) {
      const answer = m[1].trim();
      questions.push(makeQuestion("IMAGE_LAB_IDENTIFICATION", `${answer}.`, [makeOption(answer, "pdf")], answer, sourcePdf, sourcePage));
      break;
    }
  }

  const unparseablePages = questions.length === 0 ? [sourcePage] : [];
  return { questions, unparseablePages };
}

function classifyMcq(text: string, sourcePdf: string, sourcePage: number): ClassifyResult | null {
  const segments = text.split(/(?=[A-Ea-e]\.\s)/);
  const options: ExtractedOption[] = [];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i].replace(/^[A-Ea-e]\.\s*/, "").trim();
    if (seg.length > 0) options.push(makeOption(seg, "pdf"));
  }
  if (options.length >= 2) {
    const prompt = segments[0].replace(/[?:]\s*$/, "").trim().slice(0, 160);
    return {
      questions: [makeQuestion("TEXT_OR_IMAGE_MCQ", prompt.length ? prompt : "Identify the structure.", options, options[0].text, sourcePdf, sourcePage)],
      unparseablePages: [],
    };
  }
  return null;
}

function classifyDiagnosis(text: string, sourcePdf: string, sourcePage: number): ClassifyResult | null {
  const diagPatterns = [/(?:What is the diagnosis|Diagnosis:|Diagnosis is)\s*([A-Za-z0-9 .,'-]+)/i];
  for (const pat of diagPatterns) {
    const m = pat.exec(text);
    if (m) {
      const after = text.substring(m.index + m[0].length, m.index + m[0].length + 80).trim();
      const answer = (m[1] || after || "see answer key").trim();
      return {
        questions: [makeQuestion("IMAGE_DIAGNOSIS", "Identify the diagnosis shown.", [makeOption(answer, "pdf")], answer, sourcePdf, sourcePage)],
        unparseablePages: [],
      };
    }
  }
  return null;
}

function makeOption(text: string, source: ExtractedOption["source"]): ExtractedOption {
  return { id: `opt_${Date.now().toString(36)}_${(nextId++).toString(36)}`, text, source };
}

function makeQuestion(kind: QuestionKind, prompt: string, options: ExtractedOption[], answer: string, sourcePdf: string, sourcePage: number): ExtractedQuestion {
  const correctId = options[0].id;
  return {
    id: qid(),
    kind,
    prompt,
    options,
    correctOptionId: correctId,
    answer,
    traceability: { sourcePdf, sourcePage, sourceQuestionNumber: null },
    needsReview: false,
    reviewReasons: [],
    markers: [],
  };
}
