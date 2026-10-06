// Offline study-asset pipeline (no LLM required):
//   Phase 1: extract per-lecture text from its PDF page range (fixes the
//            duplicated-content problem where every lecture sharing a book
//            had the same first N chars stored).
//   Phase 2: build a hierarchical mindmap JSON from extracted headings and
//            store it in lecture.mindmap_json (only where still NULL).
//   Phase 3: render an SVG summary card per lecture into public/study-cards.
//
// Scope rules for Phase 1:
//   - lecture has pdf_page_start  -> extract exactly that page range
//   - pdf_file used by ONE lecture -> whole file belongs to it
//   - pdf_file shared but no range -> skipped (needs admin ranges first)
//   - --force                      -> replace existing derived assets after a
//                                     verified PDF boundary has changed

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";

const require_ = createRequire(import.meta.url);
const ROOT = process.env.CONTENT_ROOT ?? "C:/work/projects";
const DB = process.env.DATABASE_URL ?? "postgres://postgres:lms_dev@localhost:5432/lms";
const CARDS_DIR = resolve("public/study-cards");
const slugsArg = process.argv.find((arg) => arg.startsWith("--slugs="));
const requestedSlugs = slugsArg
  ? slugsArg.slice("--slugs=".length).split(",").map((slug) => slug.trim()).filter(Boolean)
  : null;
const moduleArg = process.argv.find((arg) => arg.startsWith("--module="))?.slice("--module=".length) || null;
const force = process.argv.includes("--force");

const sql = postgres(DB, { max: 3 });

// ── PDF text extraction (pdf.js legacy build, node-safe) ─────────────────────

let pdfjs;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjs;
}

async function extractPages(absPath, fromPage, toPage) {
  const lib = await getPdfjs();
  const data = new Uint8Array(readFileSync(absPath));
  const doc = await lib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const start = Math.max(1, fromPage);
  const end = Math.min(toPage ?? doc.numPages, doc.numPages);
  const chunks = [];

  for (let p = start; p <= end; p++) {
    try {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let text = "";
      let lastY = null;
      let lastXEnd = null;
      for (const item of tc.items) {
        if (!item.str) continue;
        const y = item.transform?.[5] ?? 0;
        const x = item.transform?.[4] ?? 0;
        // Some scanned PDFs expose every individual character as a separate
        // text item. Use the horizontal gap to distinguish a real word break
        // from consecutive letters instead of inserting a space unconditionally.
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          text += "\n";
        } else if (
          text &&
          !text.endsWith("\n") &&
          !text.endsWith(" ") &&
          lastXEnd !== null &&
          x - lastXEnd > 2.5
        ) {
          text += " ";
        }
        text += item.str;
        lastY = y;
        lastXEnd = x + (item.width ?? 0);
      }
      chunks.push(text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim());
      page.cleanup();
    } catch {
      // unreadable page — skip
    }
  }
  await doc.destroy();
  return chunks.filter(Boolean);
}

// ── Heading heuristics ───────────────────────────────────────────────────────

const JUNK =
  /(horus university|faculty of medicine|staff members|department of|semester\s*\d|^page\b|^\d{1,3}$|^Dr\.?\s|^prof\.?|^أ\.?د\.?|all rights reserved|www\.|@|http)/i;

function looksLikeHeading(line) {
  const s = line.trim();
  if (s.length < 4 || s.length > 95) return false;
  if (JUNK.test(s)) return false;
  if (/[.,;:]$/.test(s)) return false;
  if (/^\d+\s+slide/i.test(s)) return false;
  const letters = s.replace(/[^A-Za-z\u0600-\u06FF]/g, "");
  if (letters.length < 3) return false;
  const upperRatio =
    letters.replace(/[\u0600-\u06FF]/g, "").length === 0
      ? 0
      : (letters.match(/[A-Z]/g) ?? []).length /
        Math.max(1, letters.replace(/[\u0600-\u06FF]/g, "").length);
  const hasLatin = /[A-Za-z]/.test(s);
  if (hasLatin && upperRatio >= 0.65) return true;          // ALL-CAPS TITLE
  if (/^([IVXivx]{1,6}|\d+)([.)])\s+\S/.test(s) && s.length < 70) return true;
  if (/^(chapter|section|unit|lecture|review|summary|introduction|definition|causes|symptoms|signs|treatment|diagnosis|complications|management|pathophysiology|etiology|classification|types|functions|anatomy|histology|physiology|pharmacology)\b/i.test(s))
    return true;
  if (/^[\u0600-\u06FF]/.test(s) && s.length <= 60 && !/[.؟!]$/.test(s) && s.split(" ").length <= 9)
    return true;                                             // short Arabic line
  return false;
}

function cleanLine(value) {
  return value
    .replace(/^[◆■▌•▪◦●▪\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function identity(value) {
  return cleanLine(value).toLowerCase().replace(/[^a-z\u0600-\u06ff]/g, "");
}

function compact(value, max = 150) {
  const line = cleanLine(value).replace(/\.{3,}/g, "…");
  return line.length > max ? `${line.slice(0, max - 1).trim()}…` : line;
}

function isShortConcept(line) {
  const value = cleanLine(line);
  if (value.length < 3 || value.length > 80 || JUNK.test(value)) return false;
  if (looksLikeHeading(value)) return true;
  if (/^(?:The\s+)?[A-Z][A-Za-z0-9()/-]*(?:\s+[A-Za-z][A-Za-z0-9()/-]*){0,6}:?$/.test(value)) return true;
  return /^(graded response|quantal response|full agonist|partial agonist|agonist effect|antagonist effect|efficacy|potency|safety|diagnosis|treatment|management|classification|function|functions|types?|causes?|symptoms?|signs?|mechanism|complications?)\:?$/i.test(value);
}

function isMajorSection(line) {
  const value = cleanLine(line);
  if (value.length < 4 || value.length > 110) return false;
  if (/[A-Z]/.test(value) && value === value.toUpperCase()) return true;
  return /^(types?|classification|introduction|definition|anatomy|histology|physiology|pharmacology|pathophysiology|etiology|mechanism|management|diagnosis|treatment|effectiveness|complications?|causes?|symptoms?|signs?|functions?)\b/i.test(value);
}

function conceptWithDetail(line) {
  const value = compact(line);
  const match = value.match(/^(.{3,72}?)(?:\s*:\s*|\s+(?:is|are|means|refers to|includes|consists of|causes|prevents|increases|decreases)\s+)(.+)$/i);
  if (!match) return null;
  const [, term, detail] = match;
  if (
    term.split(/\s+/).length > 8 ||
    term.length > 52 ||
    detail.length < 8 ||
    /^(the response|a drug|the drug|the patient|this lecture)$/i.test(term.trim())
  ) return null;
  return `${compact(term, 60)}: ${compact(detail, 105)}`;
}

function conceptKey(value) {
  return identity(value.split(":", 1)[0]);
}

function sourceLines(text) {
  const raw = text
    .split(/\r?\n/)
    .map((source) => ({
      line: cleanLine(source),
      bullet: /^[\s◆■▌•▪◦●▪\-–—]/.test(source),
    }))
    .filter(({ line }) => line && !JUNK.test(line));
  const lines = [];
  for (const { line, bullet } of raw) {
    const previous = lines[lines.length - 1];
    // PDF extraction often wraps a single bullet onto two lines. Join only a
    // lower-case continuation so independent bullets stay separate.
    if (previous && !bullet && !/[.!?:؛]$/.test(previous) && /^[a-z\u0600-\u06ff]/.test(line) && !isShortConcept(line)) {
      lines[lines.length - 1] = compact(`${previous} ${line}`, 360);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function buildMindmap(title, text) {
  const lines = sourceLines(text);
  const sections = [];
  let current = null;
  const seenSections = new Set();

  const startSection = (label) => {
    const cleaned = compact(label, 100).replace(/:$/, "");
    const key = identity(cleaned);
    if (!key || seenSections.has(key) || sections.length >= 6) return current;
    current = { label: cleaned, children: [] };
    sections.push(current);
    seenSections.add(key);
    return current;
  };

  for (const line of lines) {
    if (isMajorSection(line)) {
      startSection(line);
      continue;
    }

    const detailed = conceptWithDetail(line);
    const shortConcept = isShortConcept(line);
    if (!current && (detailed || shortConcept)) startSection("Key concepts");
    if (!current) continue;

    const label = detailed ?? (shortConcept ? compact(line, 115).replace(/:$/, "") : null);
    if (!label) {
      if (current.children.length > 0 && /^(it is|it can|very |the response|a drug)/i.test(line)) {
        const last = current.children[current.children.length - 1];
        if (!last.label.includes(":")) {
          last.label = compact(`${last.label}: ${line}`, 150);
        }
      }
      continue;
    }
    const key = conceptKey(label);
    const hasDuplicate = current.children.some((child) => conceptKey(child.label) === key);
    if (!hasDuplicate && current.children.length < 5) {
      current.children.push({ label });
    }
  }

  const usefulSections = sections
    .map((section) => ({
      ...section,
      children: section.children.filter((child) => child.label.length >= 3),
    }))
    .filter((section) => section.children.length > 0);

  // If the source has no clear headings (common in scanned practical sheets),
  // expose clean, short labels rather than dumping arbitrary text fragments.
  if (usefulSections.length < 3) {
    const labels = [];
    const seen = new Set();
    for (const line of lines) {
      const candidate = conceptWithDetail(line) ?? (isShortConcept(line) ? compact(line, 120) : null);
      const key = candidate && identity(candidate);
      if (!candidate || !key || seen.has(key)) continue;
      seen.add(key);
      labels.push({ label: candidate });
      if (labels.length === 5) break;
    }
    if (labels.length >= 3) return { label: title.slice(0, 90), children: labels };
  }

  return {
    label: title.slice(0, 90),
    children: usefulSections.slice(0, 5),
  };
}

// A source-grounded offline summary. It is intentionally extractive: unlike an
// LLM it cannot invent clinical advice, which keeps the no-cost pipeline safe.
function buildSummary(title, text, map) {
  const leaves = (map.children ?? []).flatMap((node) =>
    node.children?.length ? node.children.map((child) => child.label) : [node.label],
  );
  const keyPoints = [...new Set(leaves.map((label) => compact(label, 160)))]
    .filter((label) => label.length >= 4)
    .slice(0, 7);
  const sections = (map.children ?? []).map((node) => node.label).filter(Boolean).slice(0, 4);
  const overview = sections.length
    ? `This lecture focuses on ${sections.join(", ")}.`
    : `${title}: this study guide is based on the verified lecture pages.`;
  const clinicalPearls = sourceLines(text)
    .filter((line) => /clinical|diagnos|treat|management|risk|complication|contraindicat/i.test(line))
    .map((line) => compact(line, 180))
    .slice(0, 3);
  return { overview, keyPoints, clinicalPearls, references: [] };
}

// ── SVG summary cards ────────────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function wrapRtl(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur.trim());
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur.trim());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{3}$/, "…");
  }
  return lines;
}

const PALETTE = ["#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#22d3ee"];

function renderCard({ title, moduleName, sections }) {
  const accent = PALETTE[[...(moduleName || "x")].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
  const W = 1200;
  const H = 630;
  const titleLines = wrapRtl(title, 42, 2);
  const rows = [];
  const listX = W - 70;
  let y = 268;
  for (const s of sections.slice(0, 5)) {
    rows.push(`<circle cx="${listX + 8}" cy="${y - 8}" r="7" fill="${accent}"/>`);
    const lines = wrapRtl(s.label, 62, 1);
    rows.push(
      `<text x="${listX}" y="${y}" text-anchor="end" font-size="27" fill="#e2e8f0" font-weight="600">${esc(lines[0] ?? "")}</text>`,
    );
    y += 56;
    if (y > H - 90) break;
  }

  const titleSpans = titleLines
    .map(
      (l, i) =>
        `<tspan x="${W - 70}" dy="${i === 0 ? 0 : 52}">${esc(l)}</tspan>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset="1" stop-color="#16233b"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="36" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" rx="36" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="2"/>
  <rect x="0" y="0" width="${W}" height="10" rx="5" fill="${accent}"/>
  <rect x="${W - 70 - esc(moduleName).length * 13 - 44}" y="52" width="${esc(moduleName).length * 13 + 44}" height="52" rx="26" fill="${accent}" fill-opacity="0.14"/>
  <text x="${W - 92}" y="86" text-anchor="end" font-size="26" fill="${accent}" font-weight="700">${esc(moduleName)}</text>
  <text x="${W - 70}" y="190" text-anchor="end" font-size="${titleLines.some((l) => l.length > 30) ? 40 : 46}" fill="#ffffff" font-weight="800">${titleSpans}</text>
  ${rows.join("\n  ")}
  <text x="${W - 70}" y="${H - 42}" text-anchor="end" font-size="22" fill="#64748b">VYLO · ملخص المحاضرة</text>
</svg>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(CARDS_DIR, { recursive: true });

  const filter = requestedSlugs
    ? "WHERE l.slug = ANY($1)"
    : moduleArg
      ? "WHERE m.slug = $1"
      : "";
  const params = requestedSlugs ? [requestedSlugs] : moduleArg ? [moduleArg] : [];
  const lectures = await sql.unsafe(
    `SELECT l.id, l.slug, l.title, l.pdf_file, l.pdf_page_start, l.pdf_page_end,
            l.content, l.mindmap_json, l.summary_json, m.name AS module_name
     FROM lecture l JOIN module m ON m.id = l.module_id
     ${filter}
     ORDER BY m."order", l."order"`,
    params,
  );
  console.log(`lectures: ${lectures.length}`);

  // Which pdf files are shared between multiple lectures?
  const usage = new Map();
  for (const l of lectures) {
    if (!l.pdf_file) continue;
    usage.set(l.pdf_file, (usage.get(l.pdf_file) ?? 0) + 1);
  }

  const docCache = new Map(); // absPath -> { numPages }
  let extracted = 0;
  let mapped = 0;
  let summarized = 0;
  let carded = 0;
  let skippedShared = 0;

  for (const l of lectures) {
    // ---- Phase 1: best available source text ------------------------------
    let text = null;
    let trusted = false; // false => content is unscoped/duplicated, skip derived assets
    if (l.pdf_file) {
      const absPath = resolve(ROOT, l.pdf_file);
      const shared = (usage.get(l.pdf_file) ?? 0) > 1;
      try {
        if (l.pdf_page_start && existsSync(absPath)) {
          const parts = await extractPages(absPath, l.pdf_page_start, l.pdf_page_end);
          text = parts.join("\n\n");
          trusted = true;
        } else if (!shared && existsSync(absPath)) {
          if (!docCache.has(absPath)) {
            const lib = await getPdfjs();
            const data = new Uint8Array(readFileSync(absPath));
            const doc = await lib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
            docCache.set(absPath, { numPages: doc.numPages });
            await doc.destroy();
          }
          const parts = await extractPages(absPath, 1, docCache.get(absPath).numPages);
          text = parts.join("\n\n");
          trusted = true;
        } else if (shared) {
          skippedShared++;
        }
      } catch (err) {
        console.error(`  ✗ extract ${l.title}: ${err.message}`);
      }
    }
    // Scanned OSPE sheets can have no extractable PDF text. When verified
    // source notes were entered for that exact lecture, use them instead of
    // leaving its study tools blank.
    if ((!text || !text.trim()) && l.content && l.content.trim().length > 100) {
      text = l.content;
      trusted = true;
    }

    // Persist corrected content when we have a proper scope
    if (text && l.pdf_page_start && text !== l.content) {
      const clipped = text.slice(0, 400_000);
      await sql`UPDATE lecture SET content = ${clipped}, updated_at = now() WHERE id = ${l.id}`;
      extracted++;
    }

    // Unscoped shared-book lectures must not keep assets derived from
    // duplicated content — clear any stale map/card for them.
    if (l.pdf_file && !l.pdf_page_start && (usage.get(l.pdf_file) ?? 0) > 1) {
      await sql`UPDATE lecture SET mindmap_json = NULL, updated_at = now() WHERE id = ${l.id} AND mindmap_json IS NOT NULL`;
      try { unlinkSync(join(CARDS_DIR, `${l.slug}.svg`)); } catch {}
      continue;
    }

    // ---- Phase 2: mindmap --------------------------------------------------
    const map = text && trusted ? buildMindmap(l.title, text.slice(0, 60_000)) : null;
    if (map && (force || !l.mindmap_json)) {
      if (map.children.length >= 3) {
        await sql`
          UPDATE lecture SET mindmap_json = ${sql.json(map)}::jsonb, updated_at = now()
          WHERE id = ${l.id}
        `;
        mapped++;
      }
    }

    if (map && text && trusted) {
      const summary = buildSummary(l.title, text.slice(0, 60_000), map);
      if (summary.keyPoints.length >= 3 && (force || !l.summary_json)) {
        await sql`
          UPDATE lecture SET summary_json = ${sql.json(summary)}::jsonb, updated_at = now()
          WHERE id = ${l.id}
        `;
        summarized++;
      }
    }

    // ---- Phase 3: SVG card -------------------------------------------------
    if (text && trusted) {
      const cardMap = buildMindmap(l.title, text.slice(0, 20_000));
      const sections = (cardMap.children ?? []).slice(0, 5);
      if (sections.length) {
        const svg = renderCard({
          title: l.title,
          moduleName: l.module_name ?? "",
          sections,
        });
        writeFileSync(join(CARDS_DIR, `${l.slug}.svg`), svg, "utf8");
        carded++;
      }
    }
  }

  console.log(`\ndone. content-updated: ${extracted}, mindmaps-created: ${mapped}, summaries-created: ${summarized}, cards: ${carded}, skipped-shared-no-range: ${skippedShared}`);
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
