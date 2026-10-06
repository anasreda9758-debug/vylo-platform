#!/usr/bin/env node

/**
 * Build a local, static, read-only human review pack for unresolved PDF
 * lineage records. This script reads existing reports and PDFs only. It never
 * connects to the database and never changes curriculum, mappings, PDFs, or
 * generated content.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute, basename } from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const PROJECT_ROOT = resolve(process.cwd());
const CONTENT_ROOT = resolve(process.env.CONTENT_ROOT ?? "C:/work/projects");
const REPORTS_DIR = resolve(PROJECT_ROOT, "reports");
const ASSET_DIR = resolve(REPORTS_DIR, "pdf-lineage-human-review-assets");
const LINEAGE_MANIFEST = resolve(REPORTS_DIR, "pdf-lineage-manifest.json");
const OUT_JSON = resolve(REPORTS_DIR, "pdf-lineage-human-review.json");
const OUT_MD = resolve(REPORTS_DIR, "pdf-lineage-human-review.md");
const OUT_HTML = resolve(REPORTS_DIR, "pdf-lineage-human-review.html");

const STATUS_ORDER = ["CONFLICT", "UNRESOLVED", "AMBIGUOUS", "STRONG_NEEDS_HUMAN"];
const ALLOWED_VERDICTS = ["CONFIRM_CURRENT", "CONFIRM_CANDIDATE", "MAPPING_WRONG", "NEEDS_FURTHER_REVIEW"];
const SHORT_SOURCE_CLASSIFICATIONS = [
  "MAPPING_CORRECT_CONTENT_EXTRACTION_BAD",
  "MAPPING_WRONG",
  "SOURCE_GENUINELY_SHORT",
  "UNSURE",
];

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function hash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function resolveExisting(rawPath, absoluteHint = null) {
  const raw = String(rawPath ?? "").replaceAll("\\", "/");
  const candidates = [];
  if (absoluteHint) candidates.push(resolve(absoluteHint));
  if (isAbsolute(raw)) candidates.push(resolve(raw));
  candidates.push(resolve(CONTENT_ROOT, raw));
  candidates.push(resolve(CONTENT_ROOT, "lecture-pdfs", basename(raw)));
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[0] ?? resolve(CONTENT_ROOT, raw);
}

function stableRange(start, end, pageCount = null) {
  const safeStart = Number.isFinite(Number(start)) ? Math.max(1, Number(start)) : 1;
  const safeEnd = Number.isFinite(Number(end)) ? Number(end) : pageCount;
  if (!Number.isFinite(safeEnd) || safeEnd < safeStart) return [];
  return [...new Set([safeStart, safeStart + Math.floor((safeEnd - safeStart) / 2), safeEnd])];
}

function candidateRangeLength(candidate) {
  if (!candidate || !Number.isFinite(candidate.startPage) || !Number.isFinite(candidate.endPage)) return null;
  return candidate.endPage - candidate.startPage + 1;
}

function excerpt(value, max = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "(no extractable text)";
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function tokenSet(value) {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

function titleMetrics(title, firstText, lastText) {
  const titleTokens = tokenSet(title);
  const pageTokens = new Set([...tokenSet(firstText), ...tokenSet(lastText)]);
  const shared = [...titleTokens].filter((token) => pageTokens.has(token));
  return {
    normalizedTitle: String(title ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
    titleTokenCount: titleTokens.size,
    sharedTitleTerms: shared,
    titleHeaderMatchRatio: titleTokens.size ? Number((shared.length / titleTokens.size).toFixed(3)) : 0,
  };
}

function strongestPhrase(firstText, lastText, title) {
  const candidates = `${firstText ?? ""}\n${lastText ?? ""}`
    .split(/[.!?\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20);
  const titleTerms = tokenSet(title);
  candidates.sort((a, b) => {
    const score = (value) => [...tokenSet(value)].filter((term) => titleTerms.has(term)).length * 100 + Math.min(value.length, 180);
    return score(b) - score(a);
  });
  return excerpt(candidates[0] ?? firstText ?? lastText, 180);
}

function findOriginalMeta(manifest, sourcePath) {
  const normalized = normalizePath(sourcePath);
  return manifest.originalPdfs.find((entry) => normalizePath(entry.relativePath) === normalized || normalizePath(entry.absolutePath) === normalized) ?? null;
}

function historicalInfo(full, manifest) {
  const historical = full?.historicalMapping;
  if (!historical?.file) return null;
  const meta = findOriginalMeta(manifest, historical.file);
  const absolutePath = resolveExisting(historical.file, meta?.absolutePath);
  const startPage = Number.isFinite(Number(historical.pageStart)) ? Number(historical.pageStart) : 1;
  const endPage = Number.isFinite(Number(historical.pageEnd)) ? Number(historical.pageEnd) : (meta?.pageCount ?? null);
  return {
    source: historical.file,
    absolutePath,
    startPage,
    endPage,
    reportedEndPage: Number.isFinite(Number(historical.pageEnd)) ? Number(historical.pageEnd) : null,
    rangeValid: Number.isFinite(endPage) && startPage >= 1 && endPage >= startPage,
    confidence: historical.confidence ?? null,
    ambiguous: Boolean(historical.ambiguous),
    explicitHistoricalVerified: Boolean(historical.explicitHistoricalVerified),
  };
}

function candidateInfo(full, manifest) {
  const candidate = full?.originalPdfCandidate;
  if (candidate?.file) {
    const meta = findOriginalMeta(manifest, candidate.file);
    return {
      kind: "LINEAGE_CANDIDATE",
      source: candidate.file,
      absolutePath: resolveExisting(candidate.file, candidate.absolutePath ?? meta?.absolutePath),
      startPage: Number(candidate.pageStart),
      endPage: Number(candidate.pageEnd),
      sourceExists: existsSync(resolveExisting(candidate.file, candidate.absolutePath ?? meta?.absolutePath)),
    };
  }
  const historical = historicalInfo(full, manifest);
  if (historical?.rangeValid) {
    return {
      kind: "HISTORICAL_FALLBACK",
      source: historical.source,
      absolutePath: historical.absolutePath,
      startPage: historical.startPage,
      endPage: historical.endPage,
      reportedEndPage: historical.reportedEndPage,
      sourceExists: existsSync(historical.absolutePath),
    };
  }
  return null;
}

function addRequest(requests, absolutePath, pages) {
  if (!absolutePath || !existsSync(absolutePath) || !pages.length) return;
  const existing = requests.get(absolutePath) ?? new Set();
  for (const page of pages) existing.add(page);
  requests.set(absolutePath, existing);
}

async function extractRequestedPages(absolutePath, requestedPages) {
  const result = { absolutePath, pageCount: null, pages: {}, error: null };
  if (!existsSync(absolutePath)) {
    result.error = "PDF file not found";
    return result;
  }
  let document;
  try {
    const bytes = new Uint8Array(readFileSync(absolutePath));
    document = await pdfjs.getDocument({ data: bytes, verbosity: 0, disableFontFace: true, useSystemFonts: false }).promise;
    result.pageCount = document.numPages;
    for (const pageNumber of [...requestedPages].sort((a, b) => a - b)) {
      if (pageNumber < 1 || pageNumber > document.numPages) continue;
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str ?? "").join(" ").replace(/\s+/g, " ").trim();
      const viewport = page.getViewport({ scale: 1 });
      result.pages[pageNumber] = {
        page: pageNumber,
        text,
        textLength: text.length,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        dimensions: `${Math.round(viewport.width)}×${Math.round(viewport.height)}`,
      };
      page.cleanup();
    }
  } catch (error) {
    result.error = String(error?.message ?? error);
  } finally {
    if (document) await document.destroy().catch(() => undefined);
  }
  return result;
}

function renderPage(absolutePath, pageNumber) {
  if (!existsSync(absolutePath)) return { image: null, error: "PDF file not found" };
  const outputName = `${hash(`${absolutePath}|${pageNumber}`)}.png`;
  const outputPath = join(ASSET_DIR, outputName);
  if (existsSync(outputPath)) return { image: `pdf-lineage-human-review-assets/${outputName}`, error: null };
  const base = outputPath.slice(0, -4);
  const result = spawnSync("pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-png", "-r", "85", "-singlefile", absolutePath, base], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !existsSync(outputPath)) {
    return { image: null, error: String(result.error?.message ?? result.stderr ?? "pdftoppm failed").trim() };
  }
  return { image: `pdf-lineage-human-review-assets/${outputName}`, error: null };
}

function previewFor(source, pages, extracted, render = true) {
  if (!source || !pages.length) return null;
  const pageCount = extracted?.pageCount ?? null;
  const usablePages = pages.filter((page) => !pageCount || page <= pageCount);
  return {
    source: source.source,
    kind: source.kind ?? "CURRENT",
    absolutePath: source.absolutePath,
    pages: usablePages.map((page) => {
      const info = extracted?.pages?.[page] ?? null;
      const rendered = render ? renderPage(source.absolutePath, page) : { image: null, error: null };
      return {
        page,
        image: rendered.image,
        renderError: rendered.error,
        text: excerpt(info?.text, 260),
        textLength: info?.textLength ?? 0,
        dimensions: info?.dimensions ?? null,
      };
    }),
    pageCount,
    error: extracted?.error ?? null,
  };
}

function sourceDiffers(candidate, historical) {
  if (!candidate || !historical || candidate.kind === "HISTORICAL_FALLBACK") return false;
  return normalizePath(candidate.source) !== normalizePath(historical.source) || candidate.startPage !== historical.startPage || candidate.endPage !== historical.endPage;
}

function neighborSummary(row) {
  if (!row) return null;
  return {
    lectureId: row.lecture.id,
    title: row.lecture.title,
    slug: row.lecture.slug,
    currentPdf: row.currentPdf.file,
    pageCount: row.currentPdf.pageCount,
    pageStart: row.currentPdf.pageStart,
    pageEnd: row.currentPdf.pageEnd,
  };
}

function neighbors(manifest, lectureId, moduleName) {
  const rows = manifest.lectures.filter((row) => row.module?.name === moduleName);
  const index = rows.findIndex((row) => row.lecture.id === lectureId);
  return {
    before: index > 0 ? neighborSummary(rows[index - 1]) : null,
    after: index >= 0 && index < rows.length - 1 ? neighborSummary(rows[index + 1]) : null,
  };
}

function statusCounts(records) {
  return Object.fromEntries(STATUS_ORDER.map((status) => [status, records.filter((record) => record.status === status).length]));
}

function sortReviewRows(manifest) {
  const fullById = new Map(manifest.lectures.map((row) => [row.lecture.id, row]));
  return manifest.manualReview
    .map((record, index) => ({ record, full: fullById.get(record.lectureId), originalIndex: index }))
    .filter(({ record, full }) => full && STATUS_ORDER.includes(record.status))
    .sort((a, b) => {
      const statusDelta = STATUS_ORDER.indexOf(a.record.status) - STATUS_ORDER.indexOf(b.record.status);
      if (statusDelta) return statusDelta;
      const priority = (item) => {
        const { full, record } = item;
        const nonText = full.currentPdf.textExtractable === false ? 1000 : 0;
        const short = full.currentPdfTextLength < 100 || full.lecture.contentLength < 100 ? 500 : 0;
        const disagreement = full.historicalLineageStatus === "CONTRADICTED" || Boolean(full.historicalMapping?.explicitHistoricalVerified) ? 100 : 0;
        const weak = !record.candidateOriginalPdf ? 20 : 0;
        return nonText + short + disagreement + weak;
      };
      return priority(b) - priority(a) || a.originalIndex - b.originalIndex;
    });
}

function evidenceFor(record, full, candidate, historical, metrics, pageRelationship) {
  const supporting = [...(record.evidence ?? [])];
  if (full.exactMatches?.length) supporting.push(`Exact page-sequence matches: ${full.exactMatches.length}`);
  if (full.nearMatches?.length) {
    const best = full.nearMatches[0];
    supporting.push(`Best near-sequence average similarity: ${best.averagePageSimilarity ?? "n/a"}`);
  }
  if (full.dimensionMatches?.length) supporting.push(`Page-dimension sequence matches: ${full.dimensionMatches.length}`);
  if (full.approvedBoundary) supporting.push(`Reviewed boundary signal: ${full.approvedBoundary.source} ${full.approvedBoundary.startPage}–${full.approvedBoundary.endPage}`);
  if (candidate) supporting.push(`Candidate source/range: ${candidate.source} ${candidate.startPage}–${candidate.endPage ?? "?"}`);
  if (metrics.sharedTitleTerms.length) supporting.push(`Shared title/header terms: ${metrics.sharedTitleTerms.join(", ")}`);
  if (pageRelationship) supporting.push(`Page-count relationship: current ${pageRelationship.currentPages}, candidate span ${pageRelationship.candidateSpan ?? "unknown"}`);

  const against = [...(full.evidenceAgainst ?? [])];
  if (record.reason) against.push(record.reason);
  if (historical && candidate && sourceDiffers(candidate, historical)) against.push(`Historical candidate differs: ${historical.source} ${historical.startPage}–${historical.reportedEndPage ?? "?"}`);
  if (!candidate) against.push("No trustworthy original candidate was established by the lineage reconstruction.");
  if (!metrics.sharedTitleTerms.length) against.push("No lecture-title terms were found in the selected current page headers.");
  return { supporting: [...new Set(supporting)], against: [...new Set(against)] };
}

function markdownPreview(preview) {
  if (!preview?.pages?.length) return "No rendered preview available.";
  return preview.pages.map((page) => `${page.page}: ${page.image ?? `render failed (${page.renderError ?? "unknown"})`}`).join("; ");
}

function renderMarkdown(pack) {
  const lines = [
    "# PDF Lineage Human Review Pack",
    "",
    `Generated: ${pack.generatedAt}`,
    `Current commit: ${pack.currentCommit}`,
    "",
    "> READ-ONLY local review artifact. No database writes, mapping changes, PDF writes, OCR, or content regeneration are performed by this pack.",
    "",
    "## Summary",
    "",
    `- Total review required: **${pack.reviewTotal}**`,
    ...STATUS_ORDER.map((status) => `- ${status}: **${pack.statusCounts[status]}**`),
    `- Non-text records: **${pack.nonTextCount}**`,
    `- Short-source records: **${pack.shortSourceCount}**`,
    "",
    "## How to review",
    "",
    "Open `pdf-lineage-human-review.html` locally. Review the current and candidate pages, choose one verdict per card, optionally add a note, then use **Export JSON** or **Copy JSON**. Save the exported file as `reports/pdf-lineage-human-decisions.json`; it is not created until a human exports decisions.",
    "",
    "## Records",
    "",
  ];
  pack.records.forEach((record, index) => {
    const historical = record.historicalCandidate;
    lines.push(`### ${index + 1}. [${record.status}] ${record.lecture}`);
    lines.push("");
    lines.push(`- Module: ${record.module}`);
    lines.push(`- Lecture ID: ${record.lectureId}`);
    lines.push(`- Current split PDF: \`${record.currentPdf.file}\` (${record.currentPdf.pageCount} pages; ${record.currentPdf.textLength} extracted characters)`);
    lines.push(`- Candidate original: ${record.candidateOriginal ? `\`${record.candidateOriginal.source}\` pages ${record.candidateOriginal.startPage}–${record.candidateOriginal.endPage}` : "none"}`);
    lines.push(`- Historical candidate/range: ${historical ? `\`${historical.source}\` pages ${historical.startPage}–${historical.reportedEndPage ?? "?"} (${historical.confidence ?? "unknown"}${historical.ambiguous ? ", ambiguous" : ""})` : "none"}`);
    lines.push(`- Flag reason: ${record.reason}`);
    lines.push(`- Supporting evidence: ${record.evidence.supporting.join("; ") || "none"}`);
    lines.push(`- Evidence against / uncertainty: ${record.evidence.against.join("; ") || "none"}`);
    lines.push(`- Neighbor before: ${record.neighbors.before ? `${record.neighbors.before.title} (${record.neighbors.before.pageStart}–${record.neighbors.before.pageEnd})` : "none"}`);
    lines.push(`- Neighbor after: ${record.neighbors.after ? `${record.neighbors.after.title} (${record.neighbors.after.pageStart}–${record.neighbors.after.pageEnd})` : "none"}`);
    lines.push(`- Current previews: ${markdownPreview(record.visual.current)}`);
    lines.push(`- Candidate previews: ${markdownPreview(record.visual.candidate)}`);
    if (record.visual.historical) lines.push(`- Historical comparison previews: ${markdownPreview(record.visual.historical)}`);
    lines.push(`- Normalized title: ${record.textEvidence.normalizedTitle}`);
    lines.push(`- Title/header match: ${record.textEvidence.titleHeaderMatchRatio}`);
    lines.push(`- Page-count relationship: current ${record.textEvidence.pageCountRelationship.currentPages}; candidate span ${record.textEvidence.pageCountRelationship.candidateSpan ?? "unknown"}; ${record.textEvidence.pageCountRelationship.matches ? "same span" : "different/unknown"}`);
    lines.push(`- Key term overlap: ${record.textEvidence.keyTermOverlap.join(", ") || "none"}`);
    lines.push(`- Strongest distinguishing phrase: ${record.textEvidence.strongestDistinguishingPhrase}`);
    lines.push(`- Current first-page excerpt: ${record.textEvidence.currentFirstPageExcerpt}`);
    lines.push(`- Current last-page excerpt: ${record.textEvidence.currentLastPageExcerpt}`);
    lines.push(`- Candidate first-page excerpt: ${record.textEvidence.candidateFirstPageExcerpt}`);
    lines.push(`- Candidate last-page excerpt: ${record.textEvidence.candidateLastPageExcerpt}`);
    lines.push("");
  });
  lines.push("## Safety and decision format", "", "Allowed verdicts: `CONFIRM_CURRENT`, `CONFIRM_CANDIDATE`, `MAPPING_WRONG`, `NEEDS_FURTHER_REVIEW`.", "", "The exported decision schema is exactly:", "", "```json", '{"lectureId":"...","module":"...","lecture":"...","verdict":"CONFIRM_CURRENT","note":"..."}', "```", "", "No decision is applied automatically.", "");
  return `${lines.join("\n")}\n`;
}

function previewHtml(preview, emptyLabel) {
  if (!preview?.pages?.length) return `<div class="empty-preview">${htmlEscape(emptyLabel)}</div>`;
  return `<div class="preview-strip">${preview.pages.map((page) => `<figure><div class="page-label">Page ${page.page}${page.dimensions ? ` · ${htmlEscape(page.dimensions)}` : ""}</div>${page.image ? `<img loading="lazy" src="${htmlEscape(page.image)}" alt="PDF page ${page.page}" />` : `<div class="image-error">${htmlEscape(page.renderError ?? "Preview unavailable")}</div>`}<figcaption>${htmlEscape(page.text)}</figcaption></figure>`).join("")}</div>`;
}

function htmlRecord(record, index) {
  const shortSource = record.shortSource;
  const shortClassOptions = ["", ...SHORT_SOURCE_CLASSIFICATIONS].map((value) => `<option value="${htmlEscape(value)}">${htmlEscape(value || "Select classification")}</option>`).join("");
  const verdictOptions = ["", ...ALLOWED_VERDICTS].map((value) => `<label class="verdict"><input type="radio" name="verdict-${htmlEscape(record.lectureId)}" value="${htmlEscape(value)}" data-lecture-id="${htmlEscape(record.lectureId)}" /> ${htmlEscape(value || "")}</label>`).join("");
  return `<article id="record-${htmlEscape(record.lectureId)}" class="record" data-index="${index}" data-status="${htmlEscape(record.status)}" data-search="${htmlEscape(`${record.module} ${record.lecture}`.toLowerCase())}">
    <div class="record-heading"><div><span class="status status-${htmlEscape(record.status.toLowerCase())}">${htmlEscape(record.status)}</span><h2>${htmlEscape(record.lecture)}</h2><p class="module">${htmlEscape(record.module)}</p></div><div class="record-number">${index + 1} / 38</div></div>
    <div class="facts"><div><b>Lecture ID</b><span>${htmlEscape(record.lectureId)}</span></div><div><b>Current PDF</b><span>${htmlEscape(record.currentPdf.file)} · ${record.currentPdf.pageCount} pages</span></div><div><b>Candidate original</b><span>${record.candidateOriginal ? `${htmlEscape(record.candidateOriginal.source)} · ${record.candidateOriginal.startPage}–${record.candidateOriginal.endPage}` : "None established"}</span></div><div><b>Historical candidate</b><span>${record.historicalCandidate ? `${htmlEscape(record.historicalCandidate.source)} · ${record.historicalCandidate.startPage}–${record.historicalCandidate.reportedEndPage ?? "?"}` : "None"}</span></div></div>
    <div class="flag"><b>Why flagged:</b> ${htmlEscape(record.reason)}</div>
    <div class="comparison"><section><h3>Current split PDF</h3>${previewHtml(record.visual.current, "Current preview unavailable")}</section><section><h3>${record.candidateOriginal?.kind === "HISTORICAL_FALLBACK" ? "Historical fallback (not an approved candidate)" : "Candidate original range"}</h3>${previewHtml(record.visual.candidate, "No candidate range established")}</section>${record.visual.historical ? `<section><h3>Historical comparison</h3>${previewHtml(record.visual.historical, "Historical preview unavailable")}</section>` : ""}</div>
    <div class="evidence-grid"><section><h3>Text evidence</h3><dl><dt>Normalized lecture title</dt><dd>${htmlEscape(record.textEvidence.normalizedTitle)}</dd><dt>Title/header match</dt><dd>${record.textEvidence.titleHeaderMatchRatio}</dd><dt>Page-count relationship</dt><dd>Current ${record.textEvidence.pageCountRelationship.currentPages}; candidate span ${record.textEvidence.pageCountRelationship.candidateSpan ?? "unknown"}; ${record.textEvidence.pageCountRelationship.matches ? "same span" : "different/unknown"}</dd><dt>Key term overlap</dt><dd>${htmlEscape(record.textEvidence.keyTermOverlap.join(", ") || "none")}</dd><dt>Strongest distinguishing phrase</dt><dd>${htmlEscape(record.textEvidence.strongestDistinguishingPhrase)}</dd></dl><div class="excerpts"><b>Current first page</b><p>${htmlEscape(record.textEvidence.currentFirstPageExcerpt)}</p><b>Current last page</b><p>${htmlEscape(record.textEvidence.currentLastPageExcerpt)}</p><b>Candidate first page</b><p>${htmlEscape(record.textEvidence.candidateFirstPageExcerpt)}</p><b>Candidate last page</b><p>${htmlEscape(record.textEvidence.candidateLastPageExcerpt)}</p></div></section><section><h3>Evidence and neighbors</h3><b>Supporting</b><ul>${record.evidence.supporting.map((item) => `<li>${htmlEscape(item)}</li>`).join("") || "<li>None</li>"}</ul><b>Against / uncertainty</b><ul>${record.evidence.against.map((item) => `<li>${htmlEscape(item)}</li>`).join("") || "<li>None</li>"}</ul><div class="neighbors"><b>Before:</b> ${htmlEscape(record.neighbors.before ? `${record.neighbors.before.title} (${record.neighbors.before.pageStart}–${record.neighbors.before.pageEnd})` : "none")}<br /><b>After:</b> ${htmlEscape(record.neighbors.after ? `${record.neighbors.after.title} (${record.neighbors.after.pageStart}–${record.neighbors.after.pageEnd})` : "none")}</div></section></div>
    ${shortSource ? `<div class="short-source"><h3>Short-source classification</h3><p>Current extracted text: ${record.currentPdf.textLength} characters. Choose one diagnosis before exporting.</p><select class="short-classification" data-lecture-id="${htmlEscape(record.lectureId)}">${shortClassOptions}</select></div>` : ""}
    <div class="decision"><h3>Human verdict</h3><div class="verdicts">${verdictOptions}</div><textarea class="note" data-lecture-id="${htmlEscape(record.lectureId)}" rows="2" placeholder="Optional short note for the controlled follow-up..."></textarea></div>
  </article>`;
}

function renderHtml(pack) {
  const dataJson = jsonForScript(pack.records);
  const cards = pack.records.map((record, index) => htmlRecord(record, index)).join("\n");
  const countsJson = jsonForScript(pack.statusCounts);
  const shortLinks = pack.records.filter((record) => record.lecture === "Cardiovascular diseases" || record.lecture === "Blood indices").map((record) => `<a href="#record-${htmlEscape(record.lectureId)}">${htmlEscape(record.lecture)} (${record.currentPdf.textLength} chars)</a>`).join(" · ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>PDF Lineage Human Review</title>
<style>
:root{color-scheme:light dark;--bg:#0b1020;--panel:#131b2e;--panel2:#19243a;--line:#33415f;--text:#edf3ff;--muted:#a9b7d3;--accent:#7db1ff;--warn:#f4c56a;--danger:#ff8a8a;--good:#77ddb1}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}header{position:sticky;top:0;z-index:5;background:rgba(11,16,32,.96);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:22px clamp(16px,4vw,52px)}h1{margin:0 0 4px;font-size:clamp(24px,3vw,36px)}h2{margin:6px 0 0;font-size:24px}h3{margin:0 0 10px;font-size:17px;color:var(--accent)}p{margin:5px 0}.subtitle{color:var(--muted)}.safety{margin-top:12px;padding:10px 12px;border:1px solid #7a5c2c;border-radius:10px;color:#ffe6ac;background:#2a2111}.stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.stat{padding:7px 10px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--muted)}.stat strong{color:var(--text)}.short-index{margin-top:14px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--muted)}.short-index a{color:var(--accent)}.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:16px}.controls button,.controls input,.controls textarea,.short-source select{border:1px solid var(--line);border-radius:8px;background:var(--panel2);color:var(--text);padding:9px 11px}.controls button{cursor:pointer}.controls button:hover{border-color:var(--accent)}#search{min-width:220px;flex:1}.export-area{display:none;width:100%;min-height:130px;font:12px/1.4 ui-monospace,monospace}.layout{max-width:1500px;margin:0 auto;padding:24px clamp(12px,3vw,42px)}.record{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px;margin:0 0 24px;box-shadow:0 12px 28px #0003}.record-heading{display:flex;justify-content:space-between;gap:16px}.record-number{color:var(--muted);white-space:nowrap}.status{display:inline-block;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:700;letter-spacing:.03em}.status-conflict{background:#6e252b;color:#ffd6d6}.status-unresolved{background:#5e4520;color:#ffe6a3}.status-ambiguous{background:#493575;color:#eadcff}.status-strong_needs_human{background:#164e58;color:#baf5ff}.module{color:var(--muted)}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin:18px 0}.facts div{border:1px solid var(--line);border-radius:10px;padding:10px;background:#0f1729}.facts b{display:block;color:var(--muted);font-size:12px;margin-bottom:3px}.facts span{display:block;overflow-wrap:anywhere}.flag{border-left:3px solid var(--warn);padding:10px 12px;background:#231d12;margin:12px 0 18px}.comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px}.comparison>section,.evidence-grid>section{border:1px solid var(--line);border-radius:12px;padding:13px;background:#10182a;min-width:0}.preview-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.preview-strip figure{margin:0;min-width:0}.preview-strip img{display:block;width:100%;height:230px;object-fit:contain;background:#fff;border-radius:7px}.page-label{font-size:11px;color:var(--muted);margin:0 0 4px}.preview-strip figcaption{font-size:11px;color:var(--muted);margin-top:4px;max-height:40px;overflow:hidden}.empty-preview,.image-error{display:grid;place-items:center;min-height:120px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);padding:12px;text-align:center}.evidence-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;margin-top:14px}.evidence-grid dl{display:grid;grid-template-columns:150px 1fr;gap:6px;margin:0}.evidence-grid dt{color:var(--muted);font-size:12px}.evidence-grid dd{margin:0;overflow-wrap:anywhere}.evidence-grid ul{margin:5px 0 13px;padding-left:22px}.excerpts{border-top:1px solid var(--line);margin-top:12px;padding-top:10px}.excerpts p{color:var(--muted);font-size:13px}.neighbors{border-top:1px solid var(--line);padding-top:10px;color:var(--muted)}.decision,.short-source{margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#10182a}.verdicts{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}.verdict{color:var(--muted);cursor:pointer}.verdict input{accent-color:var(--accent)}.note{width:100%;resize:vertical;border:1px solid var(--line);border-radius:8px;background:var(--panel2);color:var(--text);padding:9px}.short-source{border-color:#795c2b;background:#251e12}.short-source select{min-width:min(100%,430px)}footer{color:var(--muted);padding:30px 0;text-align:center}@media(max-width:700px){.preview-strip{grid-template-columns:1fr}.preview-strip img{height:300px}.record-heading{display:block}.record-number{margin-top:8px}.evidence-grid dl{grid-template-columns:1fr}.facts{grid-template-columns:1fr}}
</style></head><body>
<header><h1>PDF Lineage Human Review</h1><p class="subtitle">Local static tool · read-only · no server or database connection</p><div class="safety"><b>Safety:</b> Choosing a verdict only stores it in browser memory/local state. Nothing is applied to the database, curriculum, mappings, PDFs, or lecture content.</div><div class="stats"><div class="stat">Total required: <strong>${pack.reviewTotal}</strong></div><div class="stat">Conflict: <strong>${pack.statusCounts.CONFLICT}</strong></div><div class="stat">Unresolved: <strong>${pack.statusCounts.UNRESOLVED}</strong></div><div class="stat">Ambiguous: <strong>${pack.statusCounts.AMBIGUOUS}</strong></div><div class="stat">Strong: <strong>${pack.statusCounts.STRONG_NEEDS_HUMAN}</strong></div><div class="stat">Reviewed: <strong id="reviewed">0</strong></div><div class="stat">Confirmed current: <strong id="confirmed-current">0</strong></div><div class="stat">Confirmed candidate: <strong id="confirmed-candidate">0</strong></div><div class="stat">Wrong: <strong id="wrong">0</strong></div><div class="stat">Still unsure: <strong id="still-unsure">0</strong></div></div><div class="short-index"><b>Dedicated short-source sections:</b> ${shortLinks || "none"}</div><div class="controls"><input id="search" type="search" placeholder="Filter by module or lecture..." /><button type="button" data-filter="ALL">All</button><button type="button" data-filter="CONFLICT">Conflict</button><button type="button" data-filter="UNRESOLVED">Unresolved</button><button type="button" data-filter="AMBIGUOUS">Ambiguous</button><button type="button" data-filter="STRONG_NEEDS_HUMAN">Strong</button><button type="button" id="copy">Copy JSON</button><button type="button" id="export">Export JSON</button><button type="button" id="clear">Clear local decisions</button><textarea id="export-area" class="export-area" aria-label="Exported decisions JSON"></textarea></div></header>
<main class="layout" id="records">${cards}</main><footer>Review output is advisory only. Save exported decisions as <code>reports/pdf-lineage-human-decisions.json</code> for the next controlled session.</footer>
<script>
const RECORDS=${dataJson};
const STATUS_COUNTS=${countsJson};
const ALLOWED=${jsonForScript(ALLOWED_VERDICTS)};
const SHORT_CLASSES=${jsonForScript(SHORT_SOURCE_CLASSIFICATIONS)};
const STORAGE_KEY='horus-pdf-lineage-review-${htmlEscape(pack.currentCommit)}';
const state={};
const byId=id=>document.querySelector('[data-lecture-id="'+CSS.escape(id)+'"]');
function storageRead(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return {}}}
function storageWrite(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch{}}
function restore(){Object.assign(state,storageRead());for(const rec of RECORDS){const saved=state[rec.lectureId]||{};document.querySelectorAll('input[name="verdict-'+rec.lectureId+'"] input').forEach(()=>{});if(saved.verdict){const el=document.querySelector('input[name="verdict-'+rec.lectureId+'"][value="'+CSS.escape(saved.verdict)+'"]');if(el)el.checked=true}const note=document.querySelector('textarea.note[data-lecture-id="'+CSS.escape(rec.lectureId)+'"]');if(note)note.value=saved.note||'';const cls=document.querySelector('select.short-classification[data-lecture-id="'+CSS.escape(rec.lectureId)+'"]');if(cls)cls.value=saved.shortSourceClassification||''}}
function collect(){for(const rec of RECORDS){const checked=document.querySelector('input[name="verdict-'+rec.lectureId+'"]:checked');const noteEl=document.querySelector('textarea.note[data-lecture-id="'+CSS.escape(rec.lectureId)+'"]');const clsEl=document.querySelector('select.short-classification[data-lecture-id="'+CSS.escape(rec.lectureId)+'"]');state[rec.lectureId]={verdict:checked?checked.value:'',note:noteEl?noteEl.value.trim():'',shortSourceClassification:clsEl?clsEl.value:''};}storageWrite()}
function exportRows(){collect();return RECORDS.map(rec=>{const s=state[rec.lectureId]||{};if(!s.verdict)return null;let note=s.note||'';if(s.shortSourceClassification)note=(note?note+' | ':'')+'Short-source classification: '+s.shortSourceClassification;return {lectureId:rec.lectureId,module:rec.module,lecture:rec.lecture,verdict:s.verdict,note}}).filter(Boolean)}
function updateCounters(){const rows=exportRows();document.getElementById('reviewed').textContent=rows.length;document.getElementById('confirmed-current').textContent=rows.filter(r=>r.verdict==='CONFIRM_CURRENT').length;document.getElementById('confirmed-candidate').textContent=rows.filter(r=>r.verdict==='CONFIRM_CANDIDATE').length;document.getElementById('wrong').textContent=rows.filter(r=>r.verdict==='MAPPING_WRONG').length;document.getElementById('still-unsure').textContent=rows.filter(r=>r.verdict==='NEEDS_FURTHER_REVIEW').length}
function showExport(){const area=document.getElementById('export-area');area.style.display='block';area.value=JSON.stringify(exportRows(),null,2);area.focus();area.select();return area.value}
document.addEventListener('change',e=>{if(e.target.matches('input[type=radio],select.short-classification'))collect()});document.addEventListener('input',e=>{if(e.target.matches('textarea.note'))collect()});
document.getElementById('copy').addEventListener('click',async()=>{const value=showExport();try{await navigator.clipboard.writeText(value);alert('Decision JSON copied. Save it as reports/pdf-lineage-human-decisions.json.')}catch{alert('Copy unavailable; the JSON is selected in the export area.')}});
document.getElementById('export').addEventListener('click',()=>{const value=showExport();const blob=new Blob([value],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pdf-lineage-human-decisions.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
document.getElementById('clear').addEventListener('click',()=>{if(!confirm('Clear only browser-local decisions?'))return;for(const key of Object.keys(state))delete state[key];try{localStorage.removeItem(STORAGE_KEY)}catch{}document.querySelectorAll('input[type=radio]').forEach(el=>el.checked=false);document.querySelectorAll('textarea.note').forEach(el=>el.value='');document.querySelectorAll('select.short-classification').forEach(el=>el.value='');updateCounters()});
let activeFilter='ALL';function applyFilter(){const q=document.getElementById('search').value.toLowerCase().trim();document.querySelectorAll('.record').forEach(card=>{const okStatus=activeFilter==='ALL'||card.dataset.status===activeFilter;const okQuery=!q||card.dataset.search.includes(q);card.style.display=okStatus&&okQuery?'':'none'})}document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{activeFilter=btn.dataset.filter;applyFilter()}));document.getElementById('search').addEventListener('input',applyFilter);restore();updateCounters();
</script></body></html>`;
}

async function main() {
  mkdirSync(ASSET_DIR, { recursive: true });
  const manifest = JSON.parse(readFileSync(LINEAGE_MANIFEST, "utf8"));
  if (!manifest.readOnly || manifest.databaseModified || manifest.pdfFilesModified) throw new Error("Input lineage manifest safety flags are not read-only.");
  const reviewRows = sortReviewRows(manifest);
  if (reviewRows.length !== 38) throw new Error(`Expected 38 review records, found ${reviewRows.length}.`);

  const requests = new Map();
  const prepared = reviewRows.map(({ record, full }) => {
    const current = {
      kind: "CURRENT_SPLIT",
      source: record.currentPdf,
      absolutePath: resolveExisting(record.currentPdf, full.currentPdf?.absolutePath),
      startPage: 1,
      endPage: full.currentPdf.pageCount,
    };
    const historical = historicalInfo(full, manifest);
    const candidate = candidateInfo(full, manifest);
    const currentPages = stableRange(current.startPage, current.endPage, current.endPage);
    const candidatePages = stableRange(candidate?.startPage, candidate?.endPage, candidate?.endPage);
    const historicalPages = stableRange(historical?.startPage, historical?.endPage, historical?.endPage);
    addRequest(requests, current.absolutePath, currentPages);
    addRequest(requests, candidate?.absolutePath, candidatePages);
    if (sourceDiffers(candidate, historical)) addRequest(requests, historical?.absolutePath, historicalPages);
    return { record, full, current, candidate, historical, currentPages, candidatePages, historicalPages };
  });

  const extracted = new Map();
  for (const [absolutePath, pages] of requests) extracted.set(absolutePath, await extractRequestedPages(absolutePath, pages));

  const records = prepared.map(({ record, full, current, candidate, historical, currentPages, candidatePages, historicalPages }) => {
    const currentExtracted = extracted.get(current.absolutePath);
    const candidateExtracted = candidate ? extracted.get(candidate.absolutePath) : null;
    const historicalExtracted = historical ? extracted.get(historical.absolutePath) : null;
    const currentFirst = currentExtracted?.pages?.[currentPages[0]]?.text ?? "";
    const currentLast = currentExtracted?.pages?.[currentPages.at(-1)]?.text ?? "";
    const candidateFirst = candidateExtracted?.pages?.[candidatePages[0]]?.text ?? "";
    const candidateLast = candidateExtracted?.pages?.[candidatePages.at(-1)]?.text ?? "";
    const metrics = titleMetrics(record.title, currentFirst, currentLast);
    const candidateSpan = candidateRangeLength(candidate);
    const pageRelationship = {
      currentPages: full.currentPdf.pageCount,
      candidateSpan,
      matches: candidateSpan !== null && candidateSpan === full.currentPdf.pageCount,
    };
    const textEvidence = {
      normalizedTitle: metrics.normalizedTitle,
      titleHeaderMatchRatio: metrics.titleHeaderMatchRatio,
      keyTermOverlap: metrics.sharedTitleTerms,
      pageCountRelationship: pageRelationship,
      strongestDistinguishingPhrase: strongestPhrase(currentFirst, currentLast, record.title),
      currentFirstPageExcerpt: excerpt(currentFirst),
      currentLastPageExcerpt: excerpt(currentLast),
      candidateFirstPageExcerpt: excerpt(candidateFirst),
      candidateLastPageExcerpt: excerpt(candidateLast),
    };
    const visualCandidate = candidate ? previewFor(candidate, candidatePages, candidateExtracted) : null;
    const visualHistorical = sourceDiffers(candidate, historical) ? previewFor({ ...historical, kind: "HISTORICAL_COMPARISON" }, historicalPages, historicalExtracted) : null;
    return {
      status: record.status,
      module: record.module,
      lectureId: record.lectureId,
      lecture: record.title,
      currentPdf: {
        file: record.currentPdf,
        absolutePath: current.absolutePath,
        pageCount: full.currentPdf.pageCount,
        textLength: full.currentPdfTextLength ?? full.currentPdf.textLength ?? 0,
        textExtractable: full.currentPdf.textExtractable,
        dimensions: currentPages.map((page) => currentExtracted?.pages?.[page]?.dimensions ?? null),
      },
      candidateOriginal: candidate ? {
        kind: candidate.kind,
        source: candidate.source,
        absolutePath: candidate.absolutePath,
        startPage: candidate.startPage,
        endPage: candidate.endPage,
        reportedEndPage: candidate.reportedEndPage ?? candidate.endPage,
        pageCount: candidateExtracted?.pageCount ?? null,
        sourceExists: candidate.sourceExists,
        dimensions: candidatePages.map((page) => candidateExtracted?.pages?.[page]?.dimensions ?? null),
      } : null,
      historicalCandidate: historical ? {
        source: historical.source,
        startPage: historical.startPage,
        reportedEndPage: historical.reportedEndPage,
        confidence: historical.confidence,
        ambiguous: historical.ambiguous,
        explicitHistoricalVerified: historical.explicitHistoricalVerified,
        pageCount: historicalExtracted?.pageCount ?? null,
      } : null,
      reason: record.reason,
      evidence: evidenceFor(record, full, candidate, historical, metrics, pageRelationship),
      neighbors: neighbors(manifest, record.lectureId, record.module),
      textEvidence,
      visual: {
        current: previewFor(current, currentPages, currentExtracted),
        candidate: visualCandidate,
        historical: visualHistorical,
      },
      nonText: full.currentPdf.textExtractable === false,
      shortSource: (full.currentPdfTextLength ?? full.currentPdf.textLength ?? 0) < 100 || (full.lecture.contentLength ?? 0) < 100,
      priorityReasons: [
        ...(full.currentPdf.textExtractable === false ? ["NON_TEXT_PDF"] : []),
        ...((full.currentPdfTextLength ?? full.currentPdf.textLength ?? 0) < 100 || (full.lecture.contentLength ?? 0) < 100 ? ["SHORT_SOURCE"] : []),
        ...(historical && sourceDiffers(candidate, historical) ? ["HISTORICAL_DISAGREEMENT"] : []),
        ...(!record.candidateOriginalPdf ? ["WEAK_OR_NO_CANDIDATE"] : []),
      ],
    };
  });

  const pack = {
    generatedAt: new Date().toISOString(),
    currentCommit: manifest.currentCommit,
    readOnly: true,
    databaseModified: false,
    pdfFilesModified: false,
    mappingsModified: false,
    reviewTotal: records.length,
    statusCounts: statusCounts(records),
    nonTextCount: records.filter((record) => record.nonText).length,
    shortSourceCount: records.filter((record) => record.shortSource).length,
    allowedVerdicts: ALLOWED_VERDICTS,
    shortSourceClassifications: SHORT_SOURCE_CLASSIFICATIONS,
    decisionsOutput: "reports/pdf-lineage-human-decisions.json",
    records,
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  writeFileSync(OUT_MD, renderMarkdown(pack), "utf8");
  writeFileSync(OUT_HTML, renderHtml(pack), "utf8");
  console.log(JSON.stringify({ outputHtml: OUT_HTML, outputJson: OUT_JSON, outputMarkdown: OUT_MD, assets: ASSET_DIR, reviewTotal: pack.reviewTotal, statusCounts: pack.statusCounts, nonTextCount: pack.nonTextCount, shortSourceCount: pack.shortSourceCount, readOnly: true, databaseModified: false, pdfFilesModified: false }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
