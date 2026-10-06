import { join } from "node:path";
import { readFile } from "node:fs/promises";
import pdfParse from "pdf-parse";
import { getContentRoot } from "@/shared/content";
import type { DryRunRow, PdfReference } from "./types";

export interface PageText {
  page: number;
  text: string;
}

export async function extractPageText(pdfPath: string, page: number): Promise<PageText> {
  const buf = await readFile(pdfPath);
  const result = await pdfParse(buf);
  const pages = result.text.split(/\n{2,}/);
  const text = pages[page - 1] ?? "";
  return { page, text };
}

export async function extractPdfPages(pdfPath: string): Promise<PageText[]> {
  const buf = await readFile(pdfPath);
  const result = await pdfParse(buf);
  const pages = result.text.split(/\n{2,}/);
  return pages.map((text, i) => ({ page: i + 1, text }));
}

export async function pdfPageCount(pdfPath: string): Promise<number> {
  const buf = await readFile(pdfPath);
  const result = await pdfParse(buf);
  return result.numpages;
}

export async function pdfExists(pdfPath: string): Promise<boolean> {
  try {
    await readFile(pdfPath);
    return true;
  } catch {
    return false;
  }
}

export function resolvePdfPath(pdf: PdfReference): string {
  return join(getContentRoot(), pdf.file);
}

export async function discoverOspePdfs(): Promise<PdfReference[]> {
  const { OSPE_PDF_REFERENCES } = await import("@/features/ospe/data");
  return [...OSPE_PDF_REFERENCES];
}

export async function pageHasText(pdfPath: string, page: number): Promise<boolean> {
  const { text } = await extractPageText(pdfPath, page);
  return text.trim().length > 20;
}
