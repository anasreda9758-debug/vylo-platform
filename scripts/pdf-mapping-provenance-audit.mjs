#!/usr/bin/env node

/**
 * Read-only PDF mapping provenance audit.
 *
 * Database access in this script is deliberately limited to SELECT statements.
 * It reads the historical reports and current PDF files, then writes only the
 * two audit reports requested by the provenance audit task.
 */

import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import postgres from "postgres";

const PROJECT_ROOT = resolve(process.cwd());
const CONTENT_ROOT = resolve(process.env.CONTENT_ROOT ?? "C:/work/projects");
const PDF_ROOT = resolve(process.env.LECTURE_PDF_ROOT ?? resolve(CONTENT_ROOT, "lecture-pdfs"));
const HISTORICAL_REPORT = resolve(PROJECT_ROOT, "reports/content-mapping-audit.json");
const APPLIED_REPORT = resolve(PROJECT_ROOT, "reports/pdf-mappings-applied.json");
const OUT_JSON = resolve(PROJECT_ROOT, "reports/pdf-mapping-provenance-audit.json");
const OUT_MD = resolve(PROJECT_ROOT, "reports/pdf-mapping-provenance-audit.md");
const EXPECTED_LECTURES = 248;

function assertSelect(sqlText) {
  const normalized = sqlText.trim().replace(/^\(+/, "").toLowerCase();
  if (!normalized.startsWith("select ") && !normalized.startsWith("select\n") && !normalized.startsWith("with ")) {
    throw new Error(`Refusing non-SELECT database statement: ${sqlText.slice(0, 80)}`);
  }
  if (/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke)\b/i.test(normalized)) {
    throw new Error(`Refusing mutating database statement: ${sqlText.slice(0, 80)}`);
  }
}

async function readOnlyQuery(sql, sqlText, values = []) {
  assertSelect(sqlText);
  return sql.unsafe(sqlText, values);
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function resolvePdf(rawPath) {
  const raw = String(rawPath ?? "").replaceAll("\\", "/");
  const candidates = [];
  if (isAbsolute(raw)) candidates.push(resolve(raw));
  candidates.push(resolve(CONTENT_ROOT, raw));
  candidates.push(resolve(PDF_ROOT, basename(raw)));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? resolve(CONTENT_ROOT, raw);
}

const STOP_WORDS = new Set(
  "the a an and or of to in on for by with from into over under is are was were be been being this that these those as at it its their there than then not no yes about after before during through which where what when how can may should could would will shall do does did have has had we you they he she his her our your their lecture system module introduction general study level semester department university faculty medicine medical based using used use result results one two three four five six seven eight nine ten".split(
    /\s+/,
  ),
);

function tokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function uniqueTokens(value) {
  return [...new Set(tokens(value))];
}

function titleTokens(value) {
  return uniqueTokens(value).filter((token) => token.length >= 4);
}

function importantContentTokens(value) {
  const all = tokens(value);
  const counts = new Map();
  for (const token of all) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 80)
    .map(([token]) => token);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function extractPdf(pdfjs, absolutePath) {
  const bytes = new Uint8Array(readFileSync(absolutePath));
  const document = await pdfjs.getDocument({
    data: bytes,
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
  const pages = [];
  let extractionErrors = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      try {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str ?? "").join(" ").trim());
        page.cleanup();
      } catch {
        extractionErrors += 1;
        pages.push("");
      }
    }
  } finally {
    await document.destroy();
  }
  return {
    pageCount: document.numPages,
    pages,
    text: pages.join("\n"),
    extractionErrors,
    textExtractable: pages.some((page) => page.trim().length > 20),
  };
}

function historicalSourceMap(report) {
  const byLectureId = new Map();
  for (const pdf of report.pdfs ?? []) {
    for (const mapping of pdf.lectureMappings ?? []) {
      const record = {
        pdfFile: pdf.relativePath,
        absolutePath: pdf.absolutePath,
        pageCount: pdf.pageCount ?? null,
        pdfTextExtractable: Boolean(pdf.textExtractable),
        startPage: mapping.startPage ?? null,
        endPage: mapping.endPage ?? null,
        confidence: mapping.confidence ?? null,
        ambiguous: Boolean(mapping.ambiguous),
        evidence: mapping.evidence ?? [],
        lectureId: mapping.lectureId ?? null,
        databaseLectureId: mapping.databaseLectureId ?? null,
      };
      const id = record.databaseLectureId ?? record.lectureId;
      if (!id) continue;
      const list = byLectureId.get(id) ?? [];
      list.push(record);
      byLectureId.set(id, list);
    }
  }
  return byLectureId;
}

function isHistoricalVerified(record) {
  return Boolean(record && (record.confidence === "HIGH" || record.confidence === "MEDIUM") && !record.ambiguous);
}

function compareTuple(current, historical) {
  if (!historical) return { pdfFileMatch: false, startMatch: false, endMatch: false, exact: false };
  const pdfFileMatch = normalizePath(current.pdf_file) === normalizePath(historical.pdfFile);
  const startMatch = current.pdf_page_start === historical.startPage;
  const endMatch = current.pdf_page_end === historical.endPage;
  return { pdfFileMatch, startMatch, endMatch, exact: pdfFileMatch && startMatch && endMatch };
}

function rangeIssues(lectures, pdfMetaByPath) {
  const issues = [];
  const grouped = new Map();
  for (const lecture of lectures) {
    const key = normalizePath(lecture.pdf_file);
    const list = grouped.get(key) ?? [];
    list.push(lecture);
    grouped.set(key, list);
    const meta = pdfMetaByPath.get(key);
    if (!lecture.pdf_page_start || !lecture.pdf_page_end) {
      issues.push({ type: "missing_range", lectureId: lecture.lecture_id, lecture: lecture.title });
      continue;
    }
    if (lecture.pdf_page_start < 1) issues.push({ type: "start_before_one", lectureId: lecture.lecture_id, pages: [lecture.pdf_page_start, lecture.pdf_page_end] });
    if (lecture.pdf_page_start > lecture.pdf_page_end) issues.push({ type: "reversed_range", lectureId: lecture.lecture_id, pages: [lecture.pdf_page_start, lecture.pdf_page_end] });
    if (meta && lecture.pdf_page_end > meta.pageCount) issues.push({ type: "end_after_pdf", lectureId: lecture.lecture_id, pages: [lecture.pdf_page_start, lecture.pdf_page_end], pageCount: meta.pageCount });
  }

  for (const [pdfFile, list] of grouped) {
    const ordered = [...list].sort((a, b) => (a.pdf_page_start ?? 0) - (b.pdf_page_start ?? 0) || (a.lecture_order ?? 0) - (b.lecture_order ?? 0));
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const left = ordered[i];
        const right = ordered[j];
        if (left.pdf_page_start === right.pdf_page_start && left.pdf_page_end === right.pdf_page_end) {
          issues.push({ type: "duplicate_identical_range", pdfFile, lectureIds: [left.lecture_id, right.lecture_id], pages: [left.pdf_page_start, left.pdf_page_end] });
        } else if ((right.pdf_page_start ?? 0) <= (left.pdf_page_end ?? 0)) {
          issues.push({ type: "overlap", pdfFile, lectureIds: [left.lecture_id, right.lecture_id], pages: [[left.pdf_page_start, left.pdf_page_end], [right.pdf_page_start, right.pdf_page_end]] });
        }
      }
      const span = (ordered[i].pdf_page_end ?? 0) - (ordered[i].pdf_page_start ?? 0) + 1;
      const pageCount = pdfMetaByPath.get(pdfFile)?.pageCount ?? null;
      if (pageCount && span > 120 && span / pageCount > 0.8) {
        issues.push({ type: "implausibly_large_range", pdfFile, lectureId: ordered[i].lecture_id, pages: [ordered[i].pdf_page_start, ordered[i].pdf_page_end], pageCount });
      }
    }
    // Gaps are meaningful only when a PDF is shared by multiple lectures. A
    // split one-lecture PDF naturally starts at page 1 and has no inter-lecture gap.
    if (ordered.length > 1) {
      for (let i = 1; i < ordered.length; i += 1) {
        const previousEnd = ordered[i - 1].pdf_page_end ?? 0;
        const currentStart = ordered[i].pdf_page_start ?? 0;
        if (currentStart > previousEnd + 1) issues.push({ type: "gap", pdfFile, betweenLectureIds: [ordered[i - 1].lecture_id, ordered[i].lecture_id], pages: [previousEnd + 1, currentStart - 1] });
      }
    }
  }
  return issues;
}

function classifyLecture(lecture, historical, tuple, pdfMeta, pdfPath) {
  const baseEvidence = ["current_database_row", "current_pdf_file", "current_pdf_page_range"];
  const titleWords = titleTokens(lecture.title);
  const pdfWords = new Set(uniqueTokens(pdfMeta?.text ?? ""));
  const firstPagesText = (pdfMeta?.pages ?? []).slice(0, Math.min(3, pdfMeta?.pages?.length ?? 0)).join(" ");
  const firstPageWords = new Set(uniqueTokens(firstPagesText));
  const titleHits = titleWords.filter((word) => pdfWords.has(word));
  const firstPageTitleHits = titleWords.filter((word) => firstPageWords.has(word));
  const titleMatchRatio = titleWords.length ? titleHits.length / titleWords.length : 0;
  const firstPageTitleRatio = titleWords.length ? firstPageTitleHits.length / titleWords.length : 0;
  const sourceTokens = importantContentTokens(lecture.content);
  const contentHits = sourceTokens.filter((word) => pdfWords.has(word));
  const contentOverlap = sourceTokens.length ? contentHits.length / sourceTokens.length : 0;
  const rangeLength = lecture.pdf_page_start && lecture.pdf_page_end ? lecture.pdf_page_end - lecture.pdf_page_start + 1 : null;
  const rangeValid = Boolean(pdfMeta && lecture.pdf_page_start >= 1 && lecture.pdf_page_end >= lecture.pdf_page_start && lecture.pdf_page_end <= pdfMeta.pageCount);
  const slugBase = basename(String(lecture.pdf_file ?? ""), extname(String(lecture.pdf_file ?? ""))).toLowerCase();
  const slugFileMatch = slugBase === String(lecture.lecture_slug ?? "").toLowerCase();
  const hasText = Boolean(pdfMeta?.textExtractable && pdfMeta.text.trim().length > 20);
  const evidence = [...baseEvidence];
  const evidenceAgainst = [];
  if (pdfMeta?.pageCount != null) evidence.push(`pdf_metadata_page_count:${pdfMeta.pageCount}`);
  if (firstPageTitleRatio >= 0.75) evidence.push(`lecture_title_in_first_three_pages:${firstPageTitleRatio.toFixed(2)}`);
  else if (titleMatchRatio >= 0.75) evidence.push(`lecture_title_in_assigned_pdf:${titleMatchRatio.toFixed(2)}`);
  else evidenceAgainst.push(`title_match_below_threshold:${titleMatchRatio.toFixed(2)}`);
  if (contentOverlap >= 0.35) evidence.push(`content_term_overlap:${contentOverlap.toFixed(2)}`);
  else evidenceAgainst.push(`content_term_overlap_below_threshold:${contentOverlap.toFixed(2)}`);
  if (slugFileMatch) evidence.push("pdf_filename_matches_lecture_slug");
  if (pdfMeta?.extractionErrors) evidenceAgainst.push(`page_text_extraction_errors:${pdfMeta.extractionErrors}`);
  if (!hasText) evidenceAgainst.push("no_extractable_pdf_text");
  if (!rangeValid) evidenceAgainst.push("invalid_current_page_range");

  let provenanceClass = "PLAUSIBLE_NEEDS_REVIEW";
  let reason = "Current PDF exists, but the independent title/content and structural evidence is not strong enough for verification.";
  if (!rangeValid) {
    provenanceClass = "CONFLICT";
    reason = "Current page range is inconsistent with the current PDF metadata.";
  } else if (!hasText) {
    provenanceClass = tuple.exact ? "VERIFIED_HISTORICAL" : "UNVERIFIABLE";
    reason = tuple.exact ? "Exact historical tuple match; current PDF text is not extractable." : "The current PDF has no usable extracted text, so content-to-PDF evidence cannot be verified.";
  } else if (tuple.exact && historical && isHistoricalVerified(historical)) {
    provenanceClass = "VERIFIED_HISTORICAL";
    reason = "Current pdfFile, pdfPageStart, and pdfPageEnd exactly match an explicit HIGH/MEDIUM non-ambiguous historical mapping.";
    evidence.push("historical_explicit_verified_mapping");
  } else if (firstPageTitleRatio >= 0.75 && contentOverlap >= 0.35 && rangeValid && (slugFileMatch || rangeLength === pdfMeta.pageCount)) {
    provenanceClass = "VERIFIED_CURRENT_EVIDENCE";
    reason = "The assigned current PDF range is valid and contains the lecture title near the opening pages plus substantial lecture-content term overlap; filename/range structure is also consistent.";
  } else if (historical && historical.ambiguous) {
    reason = "The historical candidate was ambiguous/low-confidence; current file and range are plausible but require human confirmation.";
  } else if (!hasText) {
    provenanceClass = "UNVERIFIABLE";
    reason = "No usable extracted PDF text is available for an independent current-evidence check.";
  }

  return {
    provenanceClass,
    reason,
    pdfPath,
    pdfPageCount: pdfMeta?.pageCount ?? null,
    pdfTextExtractable: hasText,
    titleMatchRatio: Number(titleMatchRatio.toFixed(4)),
    firstPageTitleRatio: Number(firstPageTitleRatio.toFixed(4)),
    contentOverlap: Number(contentOverlap.toFixed(4)),
    rangeLength,
    slugFileMatch,
    evidenceSources: evidence,
    evidenceAgainst,
  };
}

function historicalReconciliation(lectures, historicalById) {
  const applied = [];
  let exactMatches = 0;
  let rangeOnlyMatches = 0;
  let mismatches = 0;
  let missingCurrent = 0;
  let conflicts = 0;
  for (const [id, records] of historicalById) {
    const historicalVerified = records.filter(isHistoricalVerified);
    if (historicalVerified.length === 0) continue;
    if (historicalVerified.length > 1) {
      conflicts += 1;
      continue;
    }
    const current = lectures.find((lecture) => lecture.lecture_id === id);
    if (!current) {
      missingCurrent += 1;
      continue;
    }
    const tuple = compareTuple(current, historicalVerified[0]);
    if (tuple.exact) exactMatches += 1;
    else {
      mismatches += 1;
      if (tuple.startMatch && tuple.endMatch) rangeOnlyMatches += 1;
    }
    applied.push({ lectureId: id, lectureTitle: current.title, historical: historicalVerified[0], current: { pdfFile: current.pdf_file, startPage: current.pdf_page_start, endPage: current.pdf_page_end }, tuple });
  }
  return { expectedHistoricalVerified: 186, historicalVerifiedRecords: applied.length, exactMatches, rangeOnlyMatches, mismatches, missingCurrent, conflictingHistoricalEntries: conflicts, entries: applied };
}

function moduleBreakdown(lectures) {
  const map = new Map();
  for (const lecture of lectures) {
    const row = map.get(lecture.moduleSlug) ?? { moduleSlug: lecture.moduleSlug, moduleName: lecture.moduleName, total: 0, verified: 0, needsReview: 0, conflicts: 0, unverifiable: 0 };
    row.total += 1;
    if (lecture.provenanceClass === "VERIFIED_HISTORICAL" || lecture.provenanceClass === "VERIFIED_CURRENT_EVIDENCE") row.verified += 1;
    if (lecture.provenanceClass === "PLAUSIBLE_NEEDS_REVIEW") row.needsReview += 1;
    if (lecture.provenanceClass === "CONFLICT") row.conflicts += 1;
    if (lecture.provenanceClass === "UNVERIFIABLE") row.unverifiable += 1;
    map.set(lecture.moduleSlug, row);
  }
  return [...map.values()].sort((a, b) => a.moduleSlug.localeCompare(b.moduleSlug));
}

function shortSourceLectures(lectures) {
  return lectures.filter((lecture) => lecture.contentLength <= 100).map((lecture) => ({
    lectureId: lecture.lectureId,
    module: lecture.moduleName,
    moduleSlug: lecture.moduleSlug,
    title: lecture.title,
    contentLength: lecture.contentLength,
    pdfFile: lecture.pdfFile,
    pages: [lecture.pdfPageStart, lecture.pdfPageEnd],
    pdfPageCount: lecture.pdfPageCount,
    pdfTextLength: lecture.pdfTextLength,
    pdfContainsSubstantiallyMoreText: lecture.pdfTextLength > Math.max(lecture.contentLength * 5, 400),
    extractionProblemLikely: lecture.pdfTextLength > Math.max(lecture.contentLength * 5, 400) && lecture.contentLength < 100,
    mappingAppearsCorrect: lecture.provenanceClass === "VERIFIED_CURRENT_EVIDENCE" || lecture.provenanceClass === "VERIFIED_HISTORICAL",
    provenanceClass: lecture.provenanceClass,
  }));
}

function buildManualQueue(lectures, rangeIssuesList, shortSources) {
  const priority = { CONFLICT: 1, UNVERIFIABLE: 2, PLAUSIBLE_NEEDS_REVIEW: 3, VERIFIED_CURRENT_EVIDENCE: 4, VERIFIED_HISTORICAL: 5 };
  const queue = [];
  for (const lecture of lectures) {
    const historicalFlag = lecture.historical && (!lecture.historicalVerified || lecture.historical.ambiguous);
    const requires = lecture.provenanceClass !== "VERIFIED_HISTORICAL" || historicalFlag;
    if (!requires) continue;
    queue.push({
      priority: priority[lecture.provenanceClass] + (historicalFlag ? 0 : 1),
      type: "lecture_mapping",
      module: lecture.moduleName,
      lecture: lecture.title,
      lectureId: lecture.lectureId,
      pdfFile: lecture.pdfFile,
      pages: [lecture.pdfPageStart, lecture.pdfPageEnd],
      provenanceClass: lecture.provenanceClass,
      reason: lecture.provenanceReason,
      evidenceFor: lecture.evidenceSources,
      evidenceAgainst: lecture.evidenceAgainst,
      recommendedHumanCheck: "Open the assigned PDF from page 1 and confirm the title, opening scope, and final-page continuity against the lecture content; compare with the historical source report if applicable.",
    });
  }
  for (const issue of rangeIssuesList) queue.push({ priority: 1, type: "range_integrity", ...issue, recommendedHumanCheck: "Inspect the neighboring lecture ranges in the source PDF and confirm whether the overlap/gap is intentional." });
  for (const source of shortSources) queue.push({ priority: 5, type: "short_source", module: source.module, lecture: source.title, lectureId: source.lectureId, pdfFile: source.pdfFile, pages: source.pages, provenanceClass: source.provenanceClass, reason: "Source content is extremely short compared with the assigned PDF text.", recommendedHumanCheck: "Compare the stored lecture content with the full assigned PDF text and verify whether the short source is intentional or an extraction/truncation issue." });
  return queue.sort((a, b) => a.priority - b.priority || String(a.module ?? "").localeCompare(String(b.module ?? "")) || String(a.lecture ?? "").localeCompare(String(b.lecture ?? "")));
}

function renderMarkdown(report) {
  const s = report.summary;
  const lines = [
    "# PDF Mapping Provenance Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Current commit: ${report.currentCommit}`,
    "",
    "## SUMMARY",
    "",
    `- Total lectures: ${s.totalLectures}`,
    `- VERIFIED_HISTORICAL: ${s.VERIFIED_HISTORICAL}`,
    `- VERIFIED_CURRENT_EVIDENCE: ${s.VERIFIED_CURRENT_EVIDENCE}`,
    `- PLAUSIBLE_NEEDS_REVIEW: ${s.PLAUSIBLE_NEEDS_REVIEW}`,
    `- CONFLICT: ${s.CONFLICT}`,
    `- UNVERIFIABLE: ${s.UNVERIFIABLE}`,
    "",
    "## HISTORICAL 186 RECONCILIATION",
    "",
    `- Historical report verified records: ${report.historicalReconciliation.historicalVerifiedRecords}`,
    `- Exact current tuple matches: ${report.historicalReconciliation.exactMatches}`,
    `- Range-only matches (PDF path changed): ${report.historicalReconciliation.rangeOnlyMatches}`,
    `- Mismatches: ${report.historicalReconciliation.mismatches}`,
    `- Missing current rows: ${report.historicalReconciliation.missingCurrent}`,
    `- Conflicting historical entries: ${report.historicalReconciliation.conflictingHistoricalEntries}`,
    "",
    "The strict tuple comparison is intentionally exact: `pdfFile`, `pdfPageStart`, and `pdfPageEnd` must all match. The later split workflow changed the PDF path to `lecture-pdfs/<lecture-slug>.pdf` and reset the range to `1–N`, so a current mapping can be content-consistent without being an exact historical tuple match.",
    "",
    "## MODULE BREAKDOWN",
    "",
    "| Module | Total | Verified | Needs review | Conflicts | Unverifiable |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.moduleBreakdown.map((m) => `| ${markdownCell(m.moduleName)} | ${m.total} | ${m.verified} | ${m.needsReview} | ${m.conflicts} | ${m.unverifiable} |`),
    "",
    "## RANGE INTEGRITY ISSUES",
    "",
    `- Issues found: ${report.rangeIntegrity.issues.length}`,
    `- Current PDF files checked: ${report.rangeIntegrity.pdfFilesChecked}`,
    `- Current PDF files missing: ${report.rangeIntegrity.pdfFilesMissing}`,
    `- Full-file 1–N ranges: ${report.rangeIntegrity.fullFileRangeCount}`,
    `- All current ranges valid: ${report.rangeIntegrity.allCurrentRangesValid ? "yes" : "no"}`,
    "",
    report.rangeIntegrity.issues.length ? "```json\n" + JSON.stringify(report.rangeIntegrity.issues, null, 2) + "\n```" : "No invalid, overlapping, duplicate, or unexplained multi-lecture ranges were found in the current split-PDF layout.",
    "",
    "## TWO SHORT SOURCE LECTURES",
    "",
    ...report.shortSourceLectures.map((x) => `- **${markdownCell(x.title)}** (${markdownCell(x.module)}): content length ${x.contentLength}; PDF ${markdownCell(x.pdfFile)} pages ${x.pages[0]}–${x.pages[1]}, extracted PDF text length ${x.pdfTextLength}; PDF contains substantially more text: ${x.pdfContainsSubstantiallyMoreText ? "yes" : "no"}; extraction problem likely: ${x.extractionProblemLikely ? "yes" : "no"}; mapping appears correct under current evidence: ${x.mappingAppearsCorrect ? "yes" : "no"}.`),
    "",
    "## MANUAL REVIEW QUEUE",
    "",
    `Items requiring human review: ${report.manualReviewQueue.length}`,
    "",
    ...report.manualReviewQueue.map((x, i) => `${i + 1}. **[P${x.priority}] ${markdownCell(x.type)} — ${markdownCell(x.lecture ?? "") }** (${markdownCell(x.module ?? "")}); PDF ${markdownCell(x.pdfFile ?? "")}; pages ${x.pages ? `${x.pages[0]}–${x.pages[1]}` : "n/a"}; class ${x.provenanceClass ?? "n/a"}. Reason: ${markdownCell(x.reason ?? "")}. Human check: ${markdownCell(x.recommendedHumanCheck ?? "")}`),
    "",
    "## PROVENANCE EXPLANATION",
    "",
    "The historical mapping report contains 248 candidate lecture mappings. Exactly 186 are HIGH/MEDIUM and non-ambiguous, matching the separate `pdf-mappings-applied.json` count; 62 are LOW or ambiguous and were explicitly skipped by the historical apply script. Git history then introduced `split-compact-lecture-pdfs.mjs`, which reads each existing range, creates a per-lecture PDF, and updates the database to the new `lecture-pdfs/<slug>.pdf` path with a local `1–N` range. This explains the shape of the current 248 mappings, but the repository does not contain a per-lecture execution manifest proving the source tuple for each of the 62 skipped mappings. Current evidence therefore verifies content/range consistency separately from historical provenance and does not automatically approve the skipped mappings.",
    "",
    "## SAFETY",
    "",
    "This audit used SELECT-only database queries and read-only PDF/report/Git inspection. It did not modify the database, PDF files, curriculum content, mappings, or application code.",
  ];
  return lines.join("\n") + "\n";
}

async function main() {
  if (!existsSync(HISTORICAL_REPORT)) throw new Error(`Missing historical report: ${HISTORICAL_REPORT}`);
  const historicalReport = JSON.parse(readFileSync(HISTORICAL_REPORT, "utf8"));
  const appliedReport = existsSync(APPLIED_REPORT) ? JSON.parse(readFileSync(APPLIED_REPORT, "utf8")) : null;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  let rows;
  try {
    const query = `SELECT m.id AS module_id, m.slug AS module_slug, m.name AS module_name,
                          m.study_year, m.term,
                          l.id AS lecture_id, l.slug AS lecture_slug, l.title,
                          l.pdf_file, l.pdf_page_start, l.pdf_page_end,
                          length(coalesce(l.content, '')) AS content_length,
                          l.content,
                          (l.summary_json IS NOT NULL) AS has_summary,
                          (l.mindmap_json IS NOT NULL) AS has_mindmap,
                          l."order" AS lecture_order
                   FROM "module" m
                   JOIN lecture l ON l.module_id = m.id
                   ORDER BY m.slug, l."order", l.title`;
    rows = await readOnlyQuery(sql, query);
  } finally {
    await sql.end();
  }
  if (rows.length !== EXPECTED_LECTURES) throw new Error(`STOP: expected ${EXPECTED_LECTURES} lecture rows, found ${rows.length}; no reports were written.`);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfMetaByPath = new Map();
  const missingPdfFiles = [];
  for (const row of rows) {
    const key = normalizePath(row.pdf_file);
    if (pdfMetaByPath.has(key)) continue;
    const pdfPath = resolvePdf(row.pdf_file);
    if (!existsSync(pdfPath)) {
      missingPdfFiles.push({ pdfFile: row.pdf_file, resolvedPath: pdfPath, lectureId: row.lecture_id });
      continue;
    }
    try {
      const meta = await extractPdf(pdfjs, pdfPath);
      pdfMetaByPath.set(key, { ...meta, absolutePath: pdfPath, pdfTextLength: meta.text.length });
    } catch (error) {
      pdfMetaByPath.set(key, { pageCount: null, pages: [], text: "", extractionErrors: 1, textExtractable: false, absolutePath: pdfPath, pdfTextLength: 0, extractionError: String(error?.message ?? error) });
    }
  }
  if (missingPdfFiles.length > 0) throw new Error(`STOP: ${missingPdfFiles.length} current PDF files are missing. First: ${JSON.stringify(missingPdfFiles[0])}; no reports were written.`);

  const historicalById = historicalSourceMap(historicalReport);
  const auditedLectures = rows.map((row) => {
    const historicalCandidates = historicalById.get(row.lecture_id) ?? [];
    const historicalVerifiedCandidates = historicalCandidates.filter(isHistoricalVerified);
    const historical = historicalVerifiedCandidates[0] ?? historicalCandidates[0] ?? null;
    const meta = pdfMetaByPath.get(normalizePath(row.pdf_file));
    const tuple = compareTuple(row, historical);
    const classification = classifyLecture(row, historical, tuple, meta, meta?.absolutePath ?? resolvePdf(row.pdf_file));
    return {
      moduleId: row.module_id,
      moduleSlug: row.module_slug,
      moduleName: row.module_name,
      studyYear: row.study_year,
      term: row.term,
      lectureId: row.lecture_id,
      lectureSlug: row.lecture_slug,
      title: row.title,
      pdfFile: row.pdf_file,
      pdfPageStart: row.pdf_page_start,
      pdfPageEnd: row.pdf_page_end,
      contentLength: Number(row.content_length ?? 0),
      hasSummary: row.has_summary,
      hasMindmap: row.has_mindmap,
      pdfPageCount: meta?.pageCount ?? null,
      pdfTextLength: meta?.pdfTextLength ?? 0,
      historical: historical ? {
        pdfFile: historical.pdfFile,
        startPage: historical.startPage,
        endPage: historical.endPage,
        confidence: historical.confidence,
        ambiguous: historical.ambiguous,
        evidence: historical.evidence,
        explicitHistoricalVerified: historicalVerifiedCandidates.length === 1,
      } : null,
      historicalVerified: historicalVerifiedCandidates.length === 1,
      historicalTupleComparison: tuple,
      provenanceClass: classification.provenanceClass,
      provenanceReason: classification.reason,
      evidenceSources: classification.evidenceSources,
      evidenceAgainst: classification.evidenceAgainst,
      pdfEvidence: {
        absolutePath: classification.pdfPath,
        pageCount: classification.pdfPageCount,
        textExtractable: classification.pdfTextExtractable,
        titleMatchRatio: classification.titleMatchRatio,
        firstPageTitleRatio: classification.firstPageTitleRatio,
        contentOverlap: classification.contentOverlap,
        rangeLength: classification.rangeLength,
        filenameMatchesLectureSlug: classification.slugFileMatch,
      },
    };
  });

  const reconciliation = historicalReconciliation(rows, historicalById);
  const counts = Object.fromEntries(["VERIFIED_HISTORICAL", "VERIFIED_CURRENT_EVIDENCE", "PLAUSIBLE_NEEDS_REVIEW", "CONFLICT", "UNVERIFIABLE"].map((name) => [name, auditedLectures.filter((row) => row.provenanceClass === name).length]));
  const issues = rangeIssues(rows, pdfMetaByPath);
  const shortSources = shortSourceLectures(auditedLectures);
  const manualReviewQueue = buildManualQueue(auditedLectures, issues, shortSources);
  const currentCommit = (process.env.AUDIT_COMMIT ?? "unknown").trim();
  const report = {
    generatedAt: new Date().toISOString(),
    currentCommit,
    readOnly: true,
    databaseModified: false,
    pdfFilesModified: false,
    sourceReports: {
      historicalMappingReport: relative(PROJECT_ROOT, HISTORICAL_REPORT).replaceAll("\\", "/"),
      historicalAppliedCountReport: relative(PROJECT_ROOT, APPLIED_REPORT).replaceAll("\\", "/"),
      historicalAppliedCount: appliedReport?.mappingsApplied ?? null,
      historicalSkippedCount: appliedReport?.mappingsSkipped ?? null,
    },
    currentDbCounts: {
      modules: new Set(rows.map((row) => row.module_id)).size,
      lectures: rows.length,
      lecturesWithContent: rows.filter((row) => Number(row.content_length ?? 0) > 0).length,
      lecturesWithPdfFile: rows.filter((row) => row.pdf_file).length,
      lecturesWithValidPdfRange: rows.filter((row) => row.pdf_page_start >= 1 && row.pdf_page_end >= row.pdf_page_start).length,
      lecturesWithSummary: rows.filter((row) => row.has_summary).length,
      lecturesWithMindmap: rows.filter((row) => row.has_mindmap).length,
    },
    summary: { totalLectures: rows.length, ...counts },
    historicalReconciliation: reconciliation,
    moduleBreakdown: moduleBreakdown(auditedLectures),
    rangeIntegrity: {
      pdfFilesChecked: pdfMetaByPath.size,
      pdfFilesMissing: missingPdfFiles.length,
      fullFileRangeCount: auditedLectures.filter((lecture) => lecture.pdfPageStart === 1 && lecture.pdfPageEnd === lecture.pdfPageCount).length,
      allCurrentRangesValid: issues.every((issue) => !["missing_range", "start_before_one", "reversed_range", "end_after_pdf"].includes(issue.type)),
      issues,
    },
    shortSourceLectures: shortSources,
    manualReviewQueue,
    provenanceFinding: "The 186 historical HIGH/MEDIUM non-ambiguous mappings were applied in the historical workflow, then the split-lecture workflow rewrote the current pdfFile and page range for the per-lecture PDF outputs. Exact current tuple comparison therefore produces a separate result from current PDF/content consistency. The 62 LOW/ambiguous mappings have no per-lecture execution manifest in the repository and remain provenance-unresolved; no automatic approval is made.",
    lectures: auditedLectures,
  };

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(OUT_MD, renderMarkdown(report), "utf8");
  console.log(JSON.stringify({ outputJson: OUT_JSON, outputMarkdown: OUT_MD, summary: report.summary, historicalReconciliation: { exactMatches: reconciliation.exactMatches, rangeOnlyMatches: reconciliation.rangeOnlyMatches, mismatches: reconciliation.mismatches, missingCurrent: reconciliation.missingCurrent }, rangeIssues: issues.length, shortSources: shortSources.length, manualReviewItems: manualReviewQueue.length, readOnly: true }));
}

main().catch((error) => {
  console.error(`[pdf-provenance-audit] ${error?.stack ?? error}`);
  process.exitCode = 1;
});
