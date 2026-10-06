import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { resolvePdfPath, extractPdfPages, pdfExists, discoverOspePdfs } from "./pdf";
import { classifyPage } from "./classify";
import { renderDryRunMarkdown } from "./dry-run";
import type { DryRunReport, DryRunRow, PdfReference, QuestionKind } from "./types";
import { getContentRoot } from "@/shared/content";

export async function runDryRun(pdf: PdfReference): Promise<DryRunReport> {
  const pdfPath = resolvePdfPath(pdf);
  if (!await pdfExists(pdfPath)) {
    return {
      schemaVersion: 1, mode: "READ_ONLY_DRY_RUN", generatedAt: new Date().toISOString(),
      sourcePdf: pdf.file,
      summary: { total: 0, confident: 0, needsReview: 0, byKind: {} as Record<QuestionKind, number> },
      rows: [], rejected: [{ index: -1, reasons: [`PDF not found: ${pdfPath}`] }],
    };
  }
  const pages = await extractPdfPages(pdfPath);
  const rows: DryRunRow[] = [];
  const rejected: Array<{ index: number; reasons: string[] }> = [];
  let idx = 0;
  const byKind: Record<QuestionKind, number> = {} as Record<QuestionKind, number>;
  for (const { page, text } of pages) {
    if (text.trim().length < 20) {
      rejected.push({ index: idx, reasons: ["Page has no readable text layer"] });
      idx++;
      continue;
    }
    const { questions, unparseablePages } = classifyPage(text, pdf.file, page);
    if (questions.length === 0 && unparseablePages.length > 0) {
      rejected.push({ index: idx, reasons: unparseablePages.map((p) => `Page ${p} could not be parsed`) });
    }
    for (const q of questions) {
      const imageExists = await imageFileExists(pdf.folder, page);
      rows.push({
        index: idx++,
        kind: q.kind,
        status: q.needsReview ? "NEEDS_REVIEW" : "CONFIDENT",
        traceability: { ...q.traceability },
        prompt: q.prompt,
        optionCount: q.options.length,
        answerFound: q.answer !== null,
        imageExists,
        reasons: q.reviewReasons,
      });
      byKind[q.kind] = (byKind[q.kind] ?? 0) + 1;
    }
  }
  const confident = rows.filter((r) => r.status === "CONFIDENT").length;
  const needsReview = rows.filter((r) => r.status === "NEEDS_REVIEW").length;
  return {
    schemaVersion: 1, mode: "READ_ONLY_DRY_RUN", generatedAt: new Date().toISOString(),
    sourcePdf: pdf.file,
    summary: { total: rows.length, confident, needsReview, byKind },
    rows, rejected,
  };
}

async function imageFileExists(folder: string, page: number): Promise<boolean> {
  const img = join(getContentRoot(), "images", folder, `OSPE ${folder}-${page}.png`);
  try { await readFile(img); return true; } catch { return false; }
}

function imageFileFor(folder: string, page: number): string {
  return `OSPE ${folder}-${page}.png`;
}

export async function dryRunToMarkdown(report: DryRunReport): Promise<string> {
  return renderDryRunMarkdown(report);
}

export async function discoverAndDryRun(): Promise<DryRunReport[]> {
  const pdfs = await discoverOspePdfs();
  const results: DryRunReport[] = [];
  for (const pdf of pdfs) {
    results.push(await runDryRun(pdf));
  }
  return results;
}
