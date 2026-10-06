#!/usr/bin/env node

/**
 * Read-only lineage reconstruction for the 248 current per-lecture PDFs.
 * It reads the historical audit, the completed provenance audit, and PDF
 * bytes/text. It writes only the requested lineage manifest reports.
 */

import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import crypto from "node:crypto";

const PROJECT_ROOT = resolve(process.cwd());
const CONTENT_ROOT = resolve(process.env.CONTENT_ROOT ?? "C:/work/projects");
const CURRENT_AUDIT = resolve(PROJECT_ROOT, "reports/pdf-mapping-provenance-audit.json");
const HISTORICAL_AUDIT = resolve(PROJECT_ROOT, "reports/content-mapping-audit.json");
const APPLIED_REPORT = resolve(PROJECT_ROOT, "reports/pdf-mappings-applied.json");
const OUT_JSON = resolve(PROJECT_ROOT, "reports/pdf-lineage-manifest.json");
const OUT_MD = resolve(PROJECT_ROOT, "reports/pdf-lineage-manifest.md");

const FINAL_STATUSES = ["CONFIRMED_HISTORICAL", "CONFIRMED_RECONSTRUCTED", "STRONG_NEEDS_HUMAN", "AMBIGUOUS", "UNRESOLVED", "CONFLICT"];

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function resolvePdf(rawPath) {
  const raw = String(rawPath ?? "").replaceAll("\\", "/");
  const candidates = [];
  if (isAbsolute(raw)) candidates.push(resolve(raw));
  candidates.push(resolve(CONTENT_ROOT, raw));
  candidates.push(resolve(CONTENT_ROOT, "lecture-pdfs", basename(raw)));
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[0] ?? resolve(CONTENT_ROOT, raw);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pageFingerprint(text) {
  const normalized = normalizeText(text);
  return { normalized, hash: normalized ? hash(normalized) : "" };
}

function wordSet(value) {
  return new Set(normalizeText(value).replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length >= 3));
}

function jaccard(left, right) {
  const a = wordSet(left);
  const b = wordSet(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function titleTokens(title) {
  return [...wordSet(title)].filter((word) => !["the", "of", "and", "to", "for", "system", "anatomy", "physiology", "pathology", "histology", "pharmacology", "molecular", "biology"].includes(word));
}

function moduleForSource(sourcePath, currentLectures) {
  const modules = new Set(currentLectures.filter((lecture) => normalizePath(lecture.historical?.pdfFile) === normalizePath(sourcePath)).map((lecture) => lecture.moduleSlug));
  return [...modules];
}

async function parsePdf(pdfjs, absolutePath, includeOperators = false) {
  const bytes = new Uint8Array(readFileSync(absolutePath));
  const document = await pdfjs.getDocument({ data: bytes, verbosity: 0, disableFontFace: true, useSystemFonts: false }).promise;
  const pageCount = document.numPages;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str ?? "").join(" ").trim();
      const viewport = page.getViewport({ scale: 1 });
      const info = { width: Math.round(viewport.width), height: Math.round(viewport.height) };
      if (includeOperators) {
        try {
          const ops = await page.getOperatorList();
          info.operatorCount = ops.fn?.length ?? null;
        } catch {
          info.operatorCount = null;
        }
      }
      pages.push({ text, ...pageFingerprint(text), ...info });
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return {
    absolutePath,
    pageCount,
    pages,
    text: pages.map((page) => page.text).join("\n"),
    textLength: pages.reduce((sum, page) => sum + page.text.length, 0),
    textExtractable: pages.some((page) => page.text.length > 20),
  };
}

function exactSequenceMatches(currentDocument, originalDocuments) {
  const currentHashes = currentDocument.pages.map((page) => page.hash);
  const nonEmpty = currentDocument.pages.map((page, index) => ({ index, length: page.normalized.length, hash: page.hash })).filter((page) => page.hash);
  // A single title fragment surrounded by blank/image pages is not a safe
  // fingerprint: it would match many scanned documents by accident.
  if (nonEmpty.length < 2 && currentDocument.textLength < 200) return [];
  const anchor = nonEmpty.sort((a, b) => b.length - a.length)[0];
  const matches = [];
  for (const original of originalDocuments) {
    for (let originalIndex = 0; originalIndex < original.pages.length; originalIndex += 1) {
      if (original.pages[originalIndex].hash !== anchor.hash) continue;
      const start = originalIndex - anchor.index;
      if (start < 0 || start + currentHashes.length > original.pages.length) continue;
      let exact = true;
      for (let offset = 0; offset < currentHashes.length; offset += 1) {
        if (currentHashes[offset] !== original.pages[start + offset].hash) {
          exact = false;
          break;
        }
      }
      if (exact) matches.push({ originalPdf: original.relativePath, absolutePath: original.absolutePath, startPage: start + 1, endPage: start + currentHashes.length, matchType: "EXACT_PAGE_SEQUENCE", matchedPages: currentHashes.length });
    }
  }
  const seen = new Set();
  return matches.filter((match) => {
    const key = `${normalizePath(match.originalPdf)}:${match.startPage}:${match.endPage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findNearMatches(currentDocument, originalDocuments, preferredSource) {
  if (!currentDocument.textExtractable) return [];
  const candidates = [];
  const preferred = originalDocuments.filter((doc) => normalizePath(doc.relativePath) === normalizePath(preferredSource));
  const docs = preferred.length ? preferred : originalDocuments;
  const length = currentDocument.pages.length;
  for (const original of docs) {
    if (original.pages.length < length) continue;
    for (let start = 0; start <= original.pages.length - length; start += 1) {
      const first = jaccard(currentDocument.pages[0].text, original.pages[start].text);
      if (first < 0.55) continue;
      let total = 0;
      let nonEmptyPages = 0;
      for (let offset = 0; offset < length; offset += 1) {
        const score = jaccard(currentDocument.pages[offset].text, original.pages[start + offset].text);
        total += score;
        if (currentDocument.pages[offset].text || original.pages[start + offset].text) nonEmptyPages += 1;
      }
      const average = nonEmptyPages ? total / nonEmptyPages : 0;
      const last = jaccard(currentDocument.pages[length - 1].text, original.pages[start + length - 1].text);
      candidates.push({ originalPdf: original.relativePath, absolutePath: original.absolutePath, startPage: start + 1, endPage: start + length, matchType: "NEAR_PAGE_SEQUENCE", firstPageSimilarity: Number(first.toFixed(4)), averagePageSimilarity: Number(average.toFixed(4)), lastPageSimilarity: Number(last.toFixed(4)) });
    }
  }
  return candidates.sort((a, b) => b.averagePageSimilarity - a.averagePageSimilarity || b.firstPageSimilarity - a.firstPageSimilarity).slice(0, 5);
}

function dimensionSequenceMatches(currentDocument, originalDocuments) {
  const current = currentDocument.pages.map((page) => `${page.width}x${page.height}`);
  if (!current.length) return [];
  const matches = [];
  for (const original of originalDocuments) {
    for (let start = 0; start <= original.pages.length - current.length; start += 1) {
      let same = true;
      for (let offset = 0; offset < current.length; offset += 1) {
        if (`${original.pages[start + offset].width}x${original.pages[start + offset].height}` !== current[offset]) { same = false; break; }
      }
      if (same) matches.push({ originalPdf: original.relativePath, absolutePath: original.absolutePath, startPage: start + 1, endPage: start + current.length, matchType: "DIMENSION_SEQUENCE" });
    }
  }
  return matches;
}

function approvedBoundaryMap() {
  return new Map([
    ["ibl-204-physiology-general-functions-of-blood", { source: "semester 2/IBL/IBL.pdf", startPage: 123, endPage: 150, evidence: "scripts/apply-approved-ibl-physiology-boundaries.mjs comment and literal boundary" }],
    ["ibl-204-physiology-blood-indices", { source: "semester 2/IBL/IBL.pdf", startPage: 151, endPage: 157, evidence: "scripts/apply-approved-ibl-physiology-boundaries.mjs comment and literal boundary" }],
    ["ibl-204-physiology-platelets-haemostasis", { source: "semester 2/IBL/IBL.pdf", startPage: 158, endPage: 180, evidence: "scripts/apply-approved-ibl-physiology-boundaries.mjs comment and literal boundary" }],
    ["ibl-204-physiology-natural-anticoagulation-mechanism", { source: "semester 2/IBL/IBL.pdf", startPage: 181, endPage: 190, evidence: "scripts/apply-approved-ibl-physiology-boundaries.mjs comment and literal boundary" }],
    ["pmb-103-pathology-neoplasia-classification-2", { source: "semester 1/Patho/Patho.pdf", startPage: 180, endPage: 187, evidence: "scripts/apply-approved-pathology-boundaries.mjs comment and literal boundary" }],
    ["rs-201-anatomy-anatomy-of-nose", { source: "semester 2/RESP/RESP.pdf", startPage: 1, endPage: 28, evidence: "scripts/apply-approved-resp-anatomy-boundaries.mjs comment and literal boundary" }],
    ["rs-201-anatomy-anatomy-of-pharynx", { source: "semester 2/RESP/RESP.pdf", startPage: 29, endPage: 69, evidence: "scripts/apply-approved-resp-anatomy-boundaries.mjs comment and literal boundary" }],
    ["rs-201-anatomy-anatomy-of-larynx-trachea-bronchi", { source: "semester 2/RESP/RESP.pdf", startPage: 70, endPage: 129, evidence: "scripts/apply-approved-resp-anatomy-boundaries.mjs comment and literal boundary" }],
    ["rs-201-anatomy-anatomy-of-lung", { source: "semester 2/RESP/RESP.pdf", startPage: 130, endPage: 162, evidence: "scripts/apply-approved-resp-anatomy-boundaries.mjs comment and literal boundary" }],
    ["rs-201-anatomy-anatomy-of-thoracic-wall-diaphragm", { source: "semester 2/RESP/RESP.pdf", startPage: 163, endPage: 186, evidence: "scripts/apply-approved-resp-anatomy-boundaries.mjs comment and literal boundary" }],
    ["rs-201-anatomy-blood-supply-innervation-of-thoracic-wall", { source: "semester 2/RESP/RESP.pdf", startPage: 187, endPage: 206, evidence: "scripts/apply-approved-resp-anatomy-boundaries.mjs comment and literal boundary" }],
    ["rs-201-anatomy-development-of-the-respiratory-system", { source: "semester 2/RESP/RESP.pdf", startPage: 207, endPage: 246, evidence: "scripts/apply-approved-resp-anatomy-boundaries.mjs comment and literal boundary" }],
  ]);
}

function historicalStatus(row, exactMatches, nearMatches, approved) {
  if (!row.historicalVerified) return null;
  const historical = row.historical;
  const exactHistorical = exactMatches.some((match) => normalizePath(match.originalPdf) === normalizePath(historical.pdfFile) && match.startPage === historical.startPage && match.endPage === historical.endPage);
  if (exactHistorical) return "CONFIRMED";
  const sameSourceDifferentRange = exactMatches.some((match) => normalizePath(match.originalPdf) === normalizePath(historical.pdfFile));
  const differentSource = exactMatches.some((match) => normalizePath(match.originalPdf) !== normalizePath(historical.pdfFile));
  const approvedDiffers = approved && (normalizePath(approved.source) !== normalizePath(historical.pdfFile) || approved.startPage !== historical.startPage || approved.endPage !== historical.endPage);
  if (sameSourceDifferentRange || differentSource || approvedDiffers) return "CONTRADICTED";
  if (nearMatches.length && nearMatches[0].averagePageSimilarity >= 0.9) return "CONTRADICTED";
  return "INSUFFICIENT";
}

function finalLineage(row, exactMatches, nearMatches, dimensions, approved) {
  const historicalExplicit = row.historicalVerified;
  const histMatch = historicalExplicit && exactMatches.some((match) => normalizePath(match.originalPdf) === normalizePath(row.historical.pdfFile) && match.startPage === row.historical.startPage && match.endPage === row.historical.endPage);
  const approvedMatch = approved && exactMatches.some((match) => normalizePath(match.originalPdf) === normalizePath(approved.source) && match.startPage === approved.startPage && match.endPage === approved.endPage);
  const approvedDimensionMatch = approved && dimensions.some((match) => normalizePath(match.originalPdf) === normalizePath(approved.source) && match.startPage === approved.startPage && match.endPage === approved.endPage);
  if (histMatch) return { status: "CONFIRMED_HISTORICAL", reason: "Exact normalized page-text sequence matches the explicit historical source and range." };
  const distinctExact = new Set(exactMatches.map((match) => `${normalizePath(match.originalPdf)}:${match.startPage}:${match.endPage}`));
  if (approvedMatch) return { status: "CONFIRMED_RECONSTRUCTED", reason: "Exact normalized page sequence agrees with a literal reviewed boundary script; the historical candidate tuple differed." };
  if (!row.historicalVerified && exactMatches.length === 1) return { status: "CONFIRMED_RECONSTRUCTED", reason: "Unique exact normalized page-text sequence match reconstructs the original source and range." };
  if (row.historicalVerified && exactMatches.length === 1 && normalizePath(exactMatches[0].originalPdf) === normalizePath(row.historical.pdfFile)) return { status: "CONFIRMED_RECONSTRUCTED", reason: "Unique exact normalized page-text sequence reconstructs a corrected range in the same historical source PDF; the historical boundary record differed." };
  if (row.historicalVerified && exactMatches.length === 1 && normalizePath(exactMatches[0].originalPdf) !== normalizePath(row.historical.pdfFile)) return { status: "CONFLICT", reason: "Exact page sequence points to a different original source/range than the explicit historical mapping." };
  if (distinctExact.size > 1) return { status: "AMBIGUOUS", reason: "More than one distinct original source/range has an exact page sequence match." };
  if (approved && exactMatches.length === 1) return { status: "CONFIRMED_RECONSTRUCTED", reason: "Exact page sequence agrees with a literal reviewed boundary script." };
  if (!row.pdfEvidence?.textExtractable && approvedDimensionMatch) return { status: "STRONG_NEEDS_HUMAN", reason: "The non-text current PDF has a page-dimension sequence consistent with a literal reviewed boundary, but visual confirmation is still required." };
  if (nearMatches.length && nearMatches[0].averagePageSimilarity >= 0.9) return { status: "STRONG_NEEDS_HUMAN", reason: "Near-exact page sequence and boundary evidence are strong, but no exact fingerprint match was found." };
  if (!row.pdfEvidence?.textExtractable && dimensions.length === 1) return { status: "STRONG_NEEDS_HUMAN", reason: "Unique page-dimension sequence supports the candidate, but the pages are not text-readable and need visual confirmation." };
  if (row.pdfEvidence?.textExtractable && nearMatches.length) return { status: "STRONG_NEEDS_HUMAN", reason: "A plausible near-sequence candidate exists but exact page fingerprints differ." };
  if (exactMatches.length > 1) return { status: "AMBIGUOUS", reason: "Exact sequence matches have unresolved duplicate source/range candidates." };
  return { status: "UNRESOLVED", reason: "No trustworthy exact or near-exact original page sequence was established." };
}

function shortCause(row, lineage) {
  if (row.contentLength > 100) return null;
  const pdfText = lineage.currentPdfTextLength;
  if (pdfText > Math.max(row.contentLength * 5, 400)) return "B_SOURCE_EXTRACTION_PROBLEM";
  if (lineage.status === "CONFLICT") return "A_PDF_MAPPING_PROBLEM";
  if (lineage.status === "CONFIRMED_HISTORICAL" || lineage.status === "CONFIRMED_RECONSTRUCTED") return "C_GENUINELY_SHORT_SOURCE_MATERIAL";
  return "D_CANNOT_DETERMINE";
}

function renderMarkdown(report) {
  const s = report.summary;
  const h = report.historical186;
  const low = report.historical62;
  const lines = [
    "# PDF Lineage Reconstruction",
    "",
    `Generated: ${report.generatedAt}`,
    `Current commit: ${report.currentCommit}`,
    "",
    "## SUMMARY",
    "",
    `- Total lectures: ${s.totalLectures}`,
    `- CONFIRMED_HISTORICAL: ${s.CONFIRMED_HISTORICAL}`,
    `- CONFIRMED_RECONSTRUCTED: ${s.CONFIRMED_RECONSTRUCTED}`,
    `- STRONG_NEEDS_HUMAN: ${s.STRONG_NEEDS_HUMAN}`,
    `- AMBIGUOUS: ${s.AMBIGUOUS}`,
    `- UNRESOLVED: ${s.UNRESOLVED}`,
    `- CONFLICT: ${s.CONFLICT}`,
    "",
    "## HISTORICAL 186",
    "",
    `- CONFIRMED: ${h.CONFIRMED}`,
    `- CONTRADICTED: ${h.CONTRADICTED}`,
    `- INSUFFICIENT: ${h.INSUFFICIENT}`,
    "",
    "Historical status is based on sequence evidence against the explicit historical source/range, not on literal current tuple equality. The current split path and 1–N range are expected to differ after the split workflow.",
    "",
    "## HISTORICAL 62 LOW/AMBIGUOUS",
    "",
    `- CONFIRMED_BY_LINEAGE: ${low.CONFIRMED_BY_LINEAGE}`,
    `- STRONG_CANDIDATE_NEEDS_HUMAN: ${low.STRONG_CANDIDATE_NEEDS_HUMAN}`,
    `- AMBIGUOUS: ${low.AMBIGUOUS}`,
    `- NO_MATCH: ${low.NO_MATCH}`,
    "",
    "## ORIGINAL PDF INVENTORY",
    "",
    `- Original report entries: ${report.originalPdfs.length}`,
    `- Original source PDFs parsed for page fingerprints: ${report.originalPdfs.filter((x) => x.parsedForLineage).length}`,
    "",
    "| Original PDF | Pages | Text-readable | Module association |",
    "|---|---:|---|---|",
    ...report.originalPdfs.map((x) => `| ${x.relativePath.replaceAll("|", "\\|")} | ${x.pageCount ?? "?"} | ${x.textExtractable ? "yes" : "no"} | ${(x.moduleAssociation ?? []).join(", ") || "unknown"} |`),
    "",
    "## NON-TEXT PDF REVIEW",
    "",
    `- VISUALLY_CONFIRMED: ${report.nonTextPdfs.VISUALLY_CONFIRMED}`,
    `- LIKELY_NEEDS_HUMAN: ${report.nonTextPdfs.LIKELY_NEEDS_HUMAN}`,
    `- UNRESOLVED: ${report.nonTextPdfs.UNRESOLVED}`,
    "",
    ...report.shortSources.map((x) => `- **${x.title}**: current PDF ${x.currentPdfPageCount} pages; current extracted text ${x.currentPdfTextLength} chars; lineage ${x.lineageStatus}; cause ${x.cause}.`),
    "",
    "## MANUAL REVIEW PACK",
    "",
    `Items requiring human confirmation: ${report.manualReview.length}`,
    "",
    ...report.manualReview.map((x, i) => `${i + 1}. **[${x.status}] ${x.title}** (${x.module}); current ${x.currentPdf}, ${x.currentPageCount} pages; candidate ${x.candidateOriginalPdf ?? "none"} pages ${x.candidatePages ? `${x.candidatePages[0]}–${x.candidatePages[1]}` : "n/a"}. Why: ${x.reason}. Evidence: ${(x.evidence ?? []).join("; ") || "none"}. Human check: ${x.humanCheck}`),
    "",
    "## LINEAGE METHOD",
    "",
    "Current and original PDFs were compared using normalized per-page text SHA-256 fingerprints and contiguous sequence matching. Near matches use per-page Jaccard similarity only as a review signal, never as sole verification. Non-text files use page-count/dimension sequence evidence and remain human-review items unless a reviewed boundary plus exact sequence exists. The split pipeline in `scripts/split-compact-lecture-pdfs.mjs` writes `lecture-pdfs/<lecture.slug>.pdf` and resets the range to `1–N`; it does not emit a lineage manifest or log.",
    "",
    "## SAFETY",
    "",
    "Read-only investigation. No database writes, PDF writes, curriculum changes, mapping changes, OCR, or generated replacement content were performed.",
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  if (!existsSync(CURRENT_AUDIT) || !existsSync(HISTORICAL_AUDIT)) throw new Error("Missing required completed audit report(s).");
  const currentAudit = JSON.parse(readFileSync(CURRENT_AUDIT, "utf8"));
  const historicalAudit = JSON.parse(readFileSync(HISTORICAL_AUDIT, "utf8"));
  const applied = existsSync(APPLIED_REPORT) ? JSON.parse(readFileSync(APPLIED_REPORT, "utf8")) : null;
  if (currentAudit.lectures.length !== 248) throw new Error(`STOP: current audit has ${currentAudit.lectures.length} lectures, expected 248.`);
  const currentLectures = currentAudit.lectures;
  const approved = approvedBoundaryMap();
  const historicalPdfs = historicalAudit.pdfs ?? [];
  const mappedOriginals = historicalPdfs.filter((pdf) => {
    const relativePath = normalizePath(pdf.relativePath);
    if (relativePath.startsWith("platform/") || relativePath.includes("node_modules/")) return false;
    // Exclude OSPE/exam/reference-book copies from lecture-lineage candidates.
    // The histology course source is explicitly a book and is retained.
    if (/ospe|exam|answer|worksheet|medical terminology/.test(relativePath) && !relativePath.includes("semester 1/histology/")) return false;
    return (pdf.lectureMappings ?? []).length > 0;
  });
  const originalPdfs = historicalPdfs.map((pdf) => ({
    relativePath: pdf.relativePath,
    absolutePath: pdf.absolutePath,
    filename: basename(pdf.relativePath),
    pageCount: pdf.pageCount ?? null,
    textExtractable: Boolean(pdf.textExtractable),
    moduleAssociation: moduleForSource(pdf.relativePath, currentLectures),
    parsedForLineage: false,
  }));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const originalDocuments = [];
  for (const entry of mappedOriginals) {
    const path = resolvePdf(entry.absolutePath ?? entry.relativePath);
    if (!existsSync(path)) continue;
    try {
      const parsed = await parsePdf(pdfjs, path, !entry.textExtractable);
      originalDocuments.push({ ...parsed, relativePath: entry.relativePath });
      const inventory = originalPdfs.find((x) => normalizePath(x.relativePath) === normalizePath(entry.relativePath));
      if (inventory) { inventory.parsedForLineage = true; inventory.pageCount = parsed.pageCount; inventory.textExtractable = parsed.textExtractable; }
    } catch {
      // Keep the inventory entry; an unparseable source remains an unresolved candidate.
    }
  }
  const originalByPath = new Map(originalDocuments.map((doc) => [normalizePath(doc.relativePath), doc]));
  const currentDocuments = new Map();
  const missingCurrent = [];
  for (const row of currentLectures) {
    const path = resolvePdf(row.pdfFile);
    if (!existsSync(path)) { missingCurrent.push({ lectureId: row.lectureId, pdfFile: row.pdfFile, path }); continue; }
    try {
      currentDocuments.set(normalizePath(row.pdfFile), await parsePdf(pdfjs, path, !row.pdfEvidence?.textExtractable));
    } catch (error) {
      currentDocuments.set(normalizePath(row.pdfFile), { absolutePath: path, pageCount: row.pdfPageCount, pages: [], text: "", textLength: 0, textExtractable: false, parseError: String(error?.message ?? error) });
    }
  }
  if (missingCurrent.length) throw new Error(`STOP: ${missingCurrent.length} current split PDFs are missing; no lineage reports written.`);

  const lineageRows = [];
  for (const row of currentLectures) {
    const currentDocument = currentDocuments.get(normalizePath(row.pdfFile));
    const exactMatches = exactSequenceMatches(currentDocument, originalDocuments);
    const nearMatches = exactMatches.length ? [] : findNearMatches(currentDocument, originalDocuments, row.historical?.pdfFile);
    const dimensions = !row.pdfEvidence?.textExtractable ? dimensionSequenceMatches(currentDocument, originalDocuments) : [];
    const approvedBoundary = approved.get(row.lectureSlug) ?? null;
    const status = finalLineage(row, exactMatches, nearMatches, dimensions, approvedBoundary);
    const histStatus = historicalStatus(row, exactMatches, nearMatches, approvedBoundary);
    const approvedDimensionMatch = approvedBoundary && dimensions.find((match) => normalizePath(match.originalPdf) === normalizePath(approvedBoundary.source) && match.startPage === approvedBoundary.startPage && match.endPage === approvedBoundary.endPage);
    const candidate = exactMatches[0] ?? nearMatches[0] ?? approvedDimensionMatch ?? (dimensions.length === 1 ? dimensions[0] : null);
    const evidence = [
      "current_split_pdf_bytes",
      `current_page_count:${currentDocument.pageCount}`,
      `current_text_length:${currentDocument.textLength}`,
      ...(exactMatches.length ? [`exact_sequence_matches:${exactMatches.length}`] : []),
      ...(nearMatches.length ? [`near_sequence_best_average:${nearMatches[0].averagePageSimilarity}`] : []),
      ...(dimensions.length ? [`dimension_sequence_matches:${dimensions.length}`] : []),
      ...(approvedBoundary ? [approvedBoundary.evidence] : []),
    ];
    const evidenceAgainst = [];
    if (row.historical && !row.historicalVerified) evidenceAgainst.push(`historical_candidate_${row.historical.confidence ?? "unknown"}_or_ambiguous`);
    if (row.historical && row.historicalVerified && histStatus !== "CONFIRMED") evidenceAgainst.push(`historical_sequence_status:${histStatus}`);
    if (!currentDocument.textExtractable) evidenceAgainst.push("current_pdf_not_text_readable");
    const lineage = {
      module: { id: row.moduleId, slug: row.moduleSlug, name: row.moduleName, studyYear: row.studyYear, term: row.term },
      lecture: { id: row.lectureId, slug: row.lectureSlug, title: row.title, contentLength: row.contentLength },
      currentPdf: { file: row.pdfFile, absolutePath: currentDocument.absolutePath, pageCount: currentDocument.pageCount, pageStart: row.pdfPageStart, pageEnd: row.pdfPageEnd, textLength: currentDocument.textLength, textExtractable: currentDocument.textExtractable },
      originalPdfCandidate: candidate ? { file: candidate.originalPdf, absolutePath: candidate.absolutePath, pageStart: candidate.startPage, pageEnd: candidate.endPage } : null,
      historicalMapping: row.historical ? { file: row.historical.pdfFile, pageStart: row.historical.startPage, pageEnd: row.historical.endPage, confidence: row.historical.confidence, ambiguous: row.historical.ambiguous, explicitHistoricalVerified: row.historicalVerified } : null,
      historicalLineageStatus: histStatus,
      lineageStatus: status.status,
      lineageReason: status.reason,
      currentEvidence: {
        priorTitleMatchRatio: row.pdfEvidence?.titleMatchRatio ?? null,
        priorFirstPageTitleRatio: row.pdfEvidence?.firstPageTitleRatio ?? null,
        priorContentOverlap: row.pdfEvidence?.contentOverlap ?? null,
      },
      lineageMethod: exactMatches.length ? "NORMALIZED_CONTIGUOUS_PAGE_TEXT_FINGERPRINT" : nearMatches.length ? "NEAR_PAGE_TEXT_FINGERPRINT_REVIEW_SIGNAL" : dimensions.length ? "PAGE_DIMENSION_SEQUENCE_STRUCTURAL_SIGNAL" : "NO_MATCH",
      evidence,
      evidenceAgainst,
      exactMatches: exactMatches.slice(0, 20),
      nearMatches,
      dimensionMatches: dimensions.slice(0, 20),
      approvedBoundary: approvedBoundary ? { ...approvedBoundary } : null,
      currentPdfTextLength: currentDocument.textLength,
    };
    lineage.shortSourceCause = shortCause(row, lineage);
    lineageRows.push(lineage);
  }

  const summary = Object.fromEntries(FINAL_STATUSES.map((status) => [status, lineageRows.filter((row) => row.lineageStatus === status).length]));
  const historical186Rows = lineageRows.filter((row) => row.historicalMapping?.explicitHistoricalVerified);
  const historical62Rows = lineageRows.filter((row) => row.historicalMapping && !row.historicalMapping.explicitHistoricalVerified);
  const historical186 = { total: historical186Rows.length, CONFIRMED: historical186Rows.filter((row) => row.historicalLineageStatus === "CONFIRMED").length, CONTRADICTED: historical186Rows.filter((row) => row.historicalLineageStatus === "CONTRADICTED").length, INSUFFICIENT: historical186Rows.filter((row) => row.historicalLineageStatus === "INSUFFICIENT").length };
  const historical62 = { total: historical62Rows.length, CONFIRMED_BY_LINEAGE: historical62Rows.filter((row) => row.lineageStatus === "CONFIRMED_RECONSTRUCTED").length, STRONG_CANDIDATE_NEEDS_HUMAN: historical62Rows.filter((row) => row.lineageStatus === "STRONG_NEEDS_HUMAN").length, AMBIGUOUS: historical62Rows.filter((row) => row.lineageStatus === "AMBIGUOUS").length, NO_MATCH: historical62Rows.filter((row) => row.lineageStatus === "UNRESOLVED" || row.lineageStatus === "CONFLICT").length };
  const nonTextRows = lineageRows.filter((row) => !row.currentPdf.textExtractable);
  const nonTextPdfs = { VISUALLY_CONFIRMED: nonTextRows.filter((row) => row.lineageStatus === "CONFIRMED_HISTORICAL" || row.lineageStatus === "CONFIRMED_RECONSTRUCTED").length, LIKELY_NEEDS_HUMAN: nonTextRows.filter((row) => row.lineageStatus === "STRONG_NEEDS_HUMAN" || row.lineageStatus === "AMBIGUOUS").length, UNRESOLVED: nonTextRows.filter((row) => row.lineageStatus === "UNRESOLVED" || row.lineageStatus === "CONFLICT").length, total: nonTextRows.length };
  const shortSources = lineageRows.filter((row) => row.lecture.contentLength <= 100).map((row) => ({ title: row.lecture.title, module: row.module.name, lectureId: row.lecture.id, currentPdf: row.currentPdf.file, currentPdfPageCount: row.currentPdf.pageCount, currentPdfTextLength: row.currentPdfTextLength, titleContentMatch: { titleMatchRatio: row.currentEvidence?.priorTitleMatchRatio ?? null, firstPageTitleRatio: row.currentEvidence?.priorFirstPageTitleRatio ?? null, contentOverlap: row.currentEvidence?.priorContentOverlap ?? null, contentLength: row.lecture.contentLength }, reconstructedOriginal: row.originalPdfCandidate, lineageStatus: row.lineageStatus, cause: row.shortSourceCause }));
  const manualReview = lineageRows.filter((row) => row.lineageStatus !== "CONFIRMED_HISTORICAL" && row.lineageStatus !== "CONFIRMED_RECONSTRUCTED").map((row) => ({ status: row.lineageStatus, module: row.module.name, lectureId: row.lecture.id, title: row.lecture.title, currentPdf: row.currentPdf.file, currentPageCount: row.currentPdf.pageCount, candidateOriginalPdf: row.originalPdfCandidate?.file ?? null, candidatePages: row.originalPdfCandidate ? [row.originalPdfCandidate.pageStart, row.originalPdfCandidate.pageEnd] : null, reason: row.lineageReason, evidence: row.evidence, humanCheck: "Compare the current PDF first/middle/last page with the candidate original range and confirm the lecture title plus boundary continuity; do not change the mapping until confirmed." }));
  const reviewPriority = { CONFLICT: 1, UNRESOLVED: 2, AMBIGUOUS: 3, STRONG_NEEDS_HUMAN: 4 };
  manualReview.sort((left, right) => (reviewPriority[left.status] ?? 9) - (reviewPriority[right.status] ?? 9) || left.module.localeCompare(right.module) || left.title.localeCompare(right.title));
  const report = {
    generatedAt: new Date().toISOString(),
    currentCommit: String(process.env.AUDIT_COMMIT ?? "unknown"),
    readOnly: true,
    databaseModified: false,
    pdfFilesModified: false,
    sourceReports: { currentProvenanceAudit: relative(PROJECT_ROOT, CURRENT_AUDIT).replaceAll("\\", "/"), historicalContentMappingAudit: relative(PROJECT_ROOT, HISTORICAL_AUDIT).replaceAll("\\", "/"), appliedCountReport: relative(PROJECT_ROOT, APPLIED_REPORT).replaceAll("\\", "/"), historicalAppliedCount: applied?.mappingsApplied ?? null, historicalSkippedCount: applied?.mappingsSkipped ?? null, splitPipeline: "scripts/split-compact-lecture-pdfs.mjs", splitPipelineGitCommit: "a631895" },
    summary: { totalLectures: lineageRows.length, ...summary },
    historical186,
    historical62,
    nonTextPdfs,
    shortSources,
    originalPdfs,
    currentPdfs: lineageRows.map((row) => ({ module: row.module, lecture: row.lecture, currentPdf: row.currentPdf, currentProvenanceClassification: currentLectures.find((x) => x.lectureId === row.lecture.id)?.provenanceClass ?? null })),
    manualReview,
    lectures: lineageRows,
  };
  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(OUT_MD, renderMarkdown(report), "utf8");
  console.log(JSON.stringify({ outputJson: OUT_JSON, outputMarkdown: OUT_MD, summary: report.summary, historical186, historical62, nonTextPdfs, shortSources: shortSources.length, manualReview: manualReview.length, readOnly: true }));
}

main().catch((error) => {
  console.error(`[pdf-lineage] ${error?.stack ?? error}`);
  process.exitCode = 1;
});
