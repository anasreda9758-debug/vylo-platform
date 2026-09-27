import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

/**
 * Source corpus discovery for the OSPE pipeline (V2).
 *
 * Design rules:
 *  - Files are identified by CONTENT HASH, not by name. `OSPE CVS.pdf` and
 *    `OSPE CVS (2).pdf` are byte-identical copies and must collapse to one
 *    document, while `OSPE RENAL.pdf` and `OSPE RENAL.pdf-1.pdf` are genuinely
 *    different documents and must stay separate.
 *  - "Ospe module 3.pdf" and "Module 3 ospe.pdf" are different documents with
 *    different roles; they are never merged on the basis of a shared word.
 */

export type PdfRole =
  | "PRACTICAL_REFERENCE"
  | "PRACTICAL_QUESTION_BANK"
  | "MIXED"
  | "UNKNOWN";

export type CorpusDoc = {
  /** Absolute path of the canonical (first-seen) file for this content hash. */
  path: string;
  fileName: string;
  /** Every path that holds identical bytes (e.g. "X (2).pdf"). */
  duplicatePaths: string[];
  sha256: string;
  bytes: number;
  module: string | null;
  subjectGuess: string | null;
  role: PdfRole;
  /** Filled in by the page parser. */
  pageCount: number | null;
  notes: string[];
};

const PDF_EXT = ".pdf";

/** Trailing "(2)", " copy", "-1" style download/copy noise. */
export function normaliseStem(fileName: string): string {
  let stem = basename(fileName, extname(fileName));
  stem = stem.replace(/\s*\(\d+\)\s*$/, ""); // " (2)"
  stem = stem.replace(/\s+copy\s*$/i, "");
  stem = stem.replace(/[-_]\d+\s*$/, ""); // "-1" from partial re-downloads
  return stem.trim();
}

/**
 * Lower score = a "cleaner" canonical filename. Byte-identical copies are
 * collapsed onto the original name, so `OSPE CVS.pdf` is reported rather than
 * whichever copy happened to sort first.
 */
function canonicalPreference(fileName: string): number {
  const stem = normaliseStem(fileName);
  let penalty = 0;
  if (/\(\d+\)/.test(fileName)) penalty += 100;
  if (/-1\.pdf$/i.test(fileName)) penalty += 100;
  if (/\bcopy\b/i.test(fileName)) penalty += 100;
  // Non-ASCII (e.g. Arabic "مع") in a name is usually a re-saved variant.
  if (/[^\x00-\x7F]/.test(fileName)) penalty += 10;
  return penalty + stem.length / 1000;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Derives the teaching module + subject from the file name.
 * Deliberately conservative: only high-signal tokens are used, and the
 * `module 3` collision is resolved by the *exact* normalised stem, not by the
 * presence of the token "3".
 */
export function inferModuleAndSubject(fileName: string): { module: string | null; subject: string | null } {
  const stem = normaliseStem(fileName).toLowerCase();

  // Exact stems first — these are the known, distinct documents.
  const EXACT: Record<string, { module: string; subject: string }> = {
    "ospe module 1": { module: "module-1", subject: "General / Sites & Stains" },
    "ospe module 2 eb": { module: "module-2", subject: "Embryology" },
    "ospe module 3": { module: "module-3", subject: "Reference / Mixed" },
    "module 3 ospe": { module: "module-3", subject: "Module 3 Exam" },
    "ospe cvs": { module: "module-3", subject: "Cardio-Vascular System" },
    "ospe resp": { module: "module-2", subject: "Respiratory System" },
    "ospe renal": { module: "module-3", subject: "Renal & Urinary System" },
    "ospe ibl": { module: "module-3", subject: "Immune, Blood & Lymphatic" },
    "pharmacology ospe": { module: "module-1", subject: "Pharmacology" },
  };
  const hit = EXACT[stem];
  if (hit) return { module: hit.module, subject: hit.subject };

  // Re-saved copies carry Arabic particles (e.g. "Ospe module 1 مع sites &
  // stains.pdf"). Strip non-ASCII so the same subject still resolves.
  const ascii = stem.replace(/[^\x00-\x7F]+/g, " ").replace(/\s+/g, " ").trim();

  const subjects: [RegExp, string][] = [
    [/cvs|cardio|cardiovascular|vascular/, "Cardio-Vascular System"],
    [/resp|respir|thorax|thoracic/, "Respiratory System"],
    [/renal|urinar|kidney|uro/, "Renal & Urinary System"],
    [/ibl|immun|blood|lymph/, "Immune, Blood & Lymphatic"],
    [/pharmacol/, "Pharmacology"],
    [/embryol|\beb\b/, "Embryology"],
    [/sites|stains/, "Sites & Stains"],
  ];
  let subject: string | null = null;
  for (const [re, s] of subjects) {
    if (re.test(ascii)) {
      subject = s;
      break;
    }
  }
  const m = ascii.match(/module[\s_-]*(\d)/);
  const moduleKey = m ? `module-${m[1]}` : null;
  return { module: moduleKey, subject };
}

/**
 * Role is decided from CONTENT, not the file name: a document is a question
 * bank when a large share of its pages classify as question pages, a reference
 * when most pages are theory/labelled-image pages, and MIXED otherwise.
 */
export function roleFromPageClassifications(
  counts: { questionPages: number; referencePages: number; titlePages: number; total: number },
): PdfRole {
  const { questionPages, referencePages, total } = counts;
  if (total === 0) return "UNKNOWN";
  const q = questionPages / total;
  const r = referencePages / total;
  if (q >= 0.5) return "PRACTICAL_QUESTION_BANK";
  if (r >= 0.5) return "PRACTICAL_REFERENCE";
  if (questionPages > 0 && referencePages > 0) return "MIXED";
  if (questionPages > 0) return "PRACTICAL_QUESTION_BANK";
  if (referencePages > 0) return "PRACTICAL_REFERENCE";
  return "UNKNOWN";
}

export type DiscoverOptions = {
  /** Directory to scan (non-recursive). */
  dir: string;
  /** Optional predicate to exclude files. */
  include?: (fileName: string) => boolean;
};

export async function discoverCorpus({ dir, include }: DiscoverOptions): Promise<CorpusDoc[]> {
  const entries = await readdir(dir);
  const pdfs = entries
    .filter((f) => extname(f).toLowerCase() === PDF_EXT)
    .filter((f) => (include ? include(f) : true))
    .sort((a, b) => a.localeCompare(b));

  const byHash = new Map<string, CorpusDoc>();
  const order: string[] = [];

  for (const fileName of pdfs) {
    const full = join(dir, fileName);
    const buf = await readFile(full);
    const hash = sha256(buf);
    const existing = byHash.get(hash);
    if (existing) {
      // Byte-identical copy (e.g. " (2).pdf") — same document. Keep whichever
      // filename is the cleanest representative.
      existing.duplicatePaths.push(full);
      if (canonicalPreference(fileName) < canonicalPreference(existing.fileName)) {
        existing.duplicatePaths.push(existing.path);
        existing.path = full;
        existing.fileName = fileName;
      }
      continue;
    }
    const { module: moduleKey, subject: subjectGuess } = inferModuleAndSubject(fileName);
    byHash.set(hash, {
      path: full,
      fileName,
      duplicatePaths: [],
      sha256: hash,
      bytes: buf.length,
      module: moduleKey,
      subjectGuess,
      role: "UNKNOWN",
      pageCount: null,
      notes: [],
    });
    order.push(hash);
  }

  for (const doc of byHash.values()) {
    // Re-derive metadata from the canonical name now that it may have changed.
    const { module: moduleKey, subject: subjectGuess } = inferModuleAndSubject(doc.fileName);
    doc.module = moduleKey;
    doc.subjectGuess = subjectGuess;
    if (doc.duplicatePaths.length > 0) {
      doc.notes.push(`${doc.duplicatePaths.length} byte-identical copy/copies collapsed`);
    }
  }

  return order.map((h) => byHash.get(h)!);
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}
