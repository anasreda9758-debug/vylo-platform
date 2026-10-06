import { discoverCorpus, roleFromPageClassifications, type CorpusDoc } from "./corpus";
import { parsePdfPages } from "./pageParse";
import { classifyPage, isQuestionPage, type PageClass } from "./classifyPage";
import { detectQuestionsOnPage, type DetectedQuestion } from "./detectQuestions";

export type PdfDryRun = {
  fileName: string;
  sha256: string;
  bytes: number;
  module: string | null;
  subject: string | null;
  role: string;
  duplicatePaths: string[];
  pages: number;
  textPages: number;
  imageOnlyPages: number;
  pageClasses: Record<string, number>;
  questions: number;
  mcq: number;
  shortAnswer: number;
  imageQuestions: number;
  referencePages: number;
  autoVerified: number;
  needsReview: number;
  answerFailures: number;
  imageAssociationFailures: number;
  questionNumbers: number[];
  maxQuestionNumber: number;
  numberGaps: number[];
  duplicateQuestionNumbers: number[];
  questionTypes: Record<string, number>;
  pointerSource: number;
  pointerManual: number;
  notes: string[];
};

export type DryRunReport = {
  generatedAt: string;
  sourceDir: string;
  documents: PdfDryRun[];
  totals: {
    documents: number;
    pages: number;
    questions: number;
    autoVerified: number;
    needsReview: number;
  };
};

export async function runDryRunV2(sourceDir: string): Promise<DryRunReport> {
  const docs = await discoverCorpus({ dir: sourceDir });
  const out: PdfDryRun[] = [];

  for (const doc of docs) {
    const parsed = await parsePdfPages(doc.path);
    const classes: Record<string, number> = {};
    let qs: DetectedQuestion[] = [];
    let questionPages = 0;
    let referencePages = 0;
    let titlePages = 0;

    for (const p of parsed.pages) {
      const c: PageClass = classifyPage(p).class;
      classes[c] = (classes[c] ?? 0) + 1;
      if (isQuestionPage(c)) questionPages += 1;
      else if (c === "THEORY" || c === "TITLE") titlePages += 1;
      else referencePages += 1;
      if (isQuestionPage(c)) qs = qs.concat(detectQuestionsOnPage(p, doc, c));
    }

    doc.pageCount = parsed.pages.length;
    doc.role = roleFromPageClassifications({
      questionPages,
      referencePages,
      titlePages,
      total: parsed.pages.length,
    });

    const numbers = qs.map((q) => q.sourceQuestionNumber).filter((n): n is number => n != null);
    const unique = [...new Set(numbers)].sort((a, b) => a - b);
    const gaps: number[] = [];
    if (unique.length) {
      for (let n = unique[0]; n <= unique[unique.length - 1]; n++) if (!unique.includes(n)) gaps.push(n);
    }
    const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    const dupSet = [...new Set(dupes)].sort((a, b) => a - b);

    const byType: Record<string, number> = {};
    for (const q of qs) byType[q.questionType] = (byType[q.questionType] ?? 0) + 1;

    const autoVerified = qs.filter((q) => q.answer !== null && q.answerConfidence === "HIGH").length;
    const needsReview = qs.filter((q) => q.needsReview).length;

    out.push({
      fileName: doc.fileName,
      sha256: doc.sha256,
      bytes: doc.bytes,
      module: doc.module,
      subject: doc.subjectGuess,
      role: doc.role,
      duplicatePaths: doc.duplicatePaths.map((p) => p.split(/[\\/]/).pop() ?? p),
      pages: parsed.pages.length,
      textPages: parsed.pages.filter((p) => p.lines.length > 0).length,
      imageOnlyPages: parsed.pages.filter((p) => p.lines.length === 0).length,
      pageClasses: classes,
      questions: qs.length,
      mcq: qs.filter((q) => q.questionType === "TEXT_OR_IMAGE_MCQ").length,
      shortAnswer: qs.filter((q) => q.answerSource === "EXPLICIT_SOURCE_TEXT").length,
      imageQuestions: qs.filter((q) => q.questionType.startsWith("IMAGE_") || q.questionType === "HISTOLOGY_LABEL").length,
      referencePages,
      autoVerified,
      needsReview,
      answerFailures: qs.filter((q) => q.answer === null).length,
      imageAssociationFailures: qs.filter((q) => q.pointerMode === "MANUAL").length,
      questionNumbers: unique,
      maxQuestionNumber: unique.length ? unique[unique.length - 1] : 0,
      numberGaps: gaps,
      duplicateQuestionNumbers: dupSet,
      questionTypes: byType,
      pointerSource: qs.filter((q) => q.pointerMode === "SOURCE").length,
      pointerManual: qs.filter((q) => q.pointerMode === "MANUAL").length,
      notes: doc.notes,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceDir,
    documents: out,
    totals: {
      documents: out.length,
      pages: out.reduce((a, d) => a + d.pages, 0),
      questions: out.reduce((a, d) => a + d.questions, 0),
      autoVerified: out.reduce((a, d) => a + d.autoVerified, 0),
      needsReview: out.reduce((a, d) => a + d.needsReview, 0),
    },
  };
}

export function renderDryRunMarkdownV2(r: DryRunReport): string {
  const L: string[] = [];
  L.push("# OSPE Source Pipeline — Dry Run V2");
  L.push("");
  L.push(`Generated: ${r.generatedAt}`);
  L.push(`Source: \`${r.sourceDir}\``);
  L.push("");
  L.push("> DRY RUN ONLY — nothing was imported into the live database.");
  L.push("");
  L.push("## Totals");
  L.push("");
  L.push(`- Documents: **${r.totals.documents}**`);
  L.push(`- Pages: **${r.totals.pages}**`);
  L.push(`- Question candidates: **${r.totals.questions}**`);
  L.push(`- Auto-verified (HIGH confidence answer): **${r.totals.autoVerified}**`);
  L.push(`- Needs review: **${r.totals.needsReview}**`);
  L.push("");
  L.push("## Per document");
  L.push("");
  L.push("| PDF | Role | Pages | Q | MCQ | Short | Ref pages | Verified | Needs review | Answer fail | Max Q# | Gaps |");
  L.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const d of r.documents) {
    L.push(
      `| ${d.fileName} | ${d.role} | ${d.pages} | ${d.questions} | ${d.mcq} | ${d.shortAnswer} | ${d.referencePages} | ${d.autoVerified} | ${d.needsReview} | ${d.answerFailures} | ${d.maxQuestionNumber} | ${d.numberGaps.length} |`,
    );
  }
  L.push("");
  L.push("## Question types");
  L.push("");
  const types: Record<string, number> = {};
  for (const d of r.documents) for (const [k, v] of Object.entries(d.questionTypes)) types[k] = (types[k] ?? 0) + v;
  L.push("| Type | Count |");
  L.push("|---|---:|");
  for (const [k, v] of Object.entries(types).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push("");
  L.push("## Pointer mode");
  L.push("");
  L.push(`- SOURCE (no manual arrow needed): **${r.documents.reduce((a, d) => a + d.pointerSource, 0)}**`);
  L.push(`- MANUAL (would need a placed marker): **${r.documents.reduce((a, d) => a + d.pointerManual, 0)}**`);
  L.push("");
  L.push("## Documented blockers");
  L.push("");
  for (const d of r.documents) {
    if (d.imageOnlyPages > 0) {
      L.push(`- **${d.fileName}**: ${d.imageOnlyPages}/${d.pages} pages have no extractable text (scanned/image-only). No deterministic question or answer extraction is possible without OCR.`);
    }
    if (d.duplicatePaths.length) {
      L.push(`- **${d.fileName}**: ${d.duplicatePaths.length} byte-identical copy/copies collapsed (${d.duplicatePaths.join(", ")}).`);
    }
  }
  L.push("");
  return L.join("\n");
}
