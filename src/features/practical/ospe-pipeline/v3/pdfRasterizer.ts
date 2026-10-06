/**
 * External PDF page rasterizer.
 *
 * The in-process @napi-rs/canvas + pdfjs renderer native-crashes Node on large
 * real-world PDFs (heap corruption, no recoverable JS error), so it is not used
 * anywhere in this pipeline. Page rasterization is delegated to Poppler's
 * pdftoppm, which is a mature, dependency-free binary.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PDF_RASTERIZER_NOT_AVAILABLE = "PDF_RASTERIZER_NOT_AVAILABLE";

export type RasterizerKind = "pdftoppm" | "mutool";

export type RasterizedPage = {
  page: number;
  dpi: number;
  /** Absolute path of the written PNG. */
  outputPath: string;
  widthPx: number;
  heightPx: number;
  rasterizer: RasterizerKind;
};

/** Extra search locations, since winget installs outside PATH in some setups. */
const EXTRA_BIN_DIRS = [
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages") : "",
].filter(Boolean);

const WINGET_PACKAGE_RE = /oschwartz10612\.Poppler/i;

const searchDirs = (): string[] => {
  const dirs: string[] = [];
  for (const d of EXTRA_BIN_DIRS) {
    if (!existsSync(d)) continue;
    for (const pkg of readdirSync(d)) {
      if (!WINGET_PACKAGE_RE.test(pkg)) continue;
      const base = join(d, pkg);
      for (const inner of readdirSync(base)) {
        dirs.push(join(base, inner, "Library", "bin"));
      }
    }
  }
  return dirs;
};

const candidates = (bin: string): string[] => {
  const list = [bin];
  if (process.platform === "win32") {
    list.push(`${bin}.exe`, `${bin}.cmd`);
    for (const d of searchDirs()) list.push(join(d, `${bin}.exe`));
  }
  return list;
};

/** Returns the absolute path of a usable rasterizer, or null. */
export const findRasterizer = (kind: RasterizerKind): string | null => {
  for (const c of candidates(kind)) {
    try {
      if (existsSync(c) && !isDirectory(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
};

const isDirectory = (p: string): boolean => {
  try {
    // existsSync is true for dirs too; a rasterizer is a file.
    return !p.toLowerCase().endsWith(".exe") && !p.toLowerCase().endsWith(".cmd");
  } catch {
    return false;
  }
};

export const discoverRasterizer = (): { kind: RasterizerKind; bin: string } | null => {
  for (const kind of ["pdftoppm", "mutool"] as RasterizerKind[]) {
    const bin = findRasterizer(kind);
    if (bin) return { kind, bin };
  }
  return null;
};

const assertPage = (page: number) => {
  if (!Number.isInteger(page) || page < 1 || page > 100000) {
    throw new RangeError(`invalid PDF page: ${page}`);
  }
};

/** 72 dpi is PDF user-space; practical extraction wants 200-250. */
const assertDpi = (dpi: number) => {
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 600) {
    throw new RangeError(`invalid dpi: ${dpi} (expected 72-600)`);
  }
};

/** Keeps generated files inside the caller's intended output directory. */
const assertOutputPath = (outputPath: string, allowedRoot: string): string => {
  const out = resolve(outputPath);
  const root = resolve(allowedRoot);
  if (out !== root && !out.startsWith(root + sep)) {
    throw new Error(`refusing to write outside ${root}: ${outputPath}`);
  }
  return out;
};

export const pdfPointsToPixels = (points: number, dpi: number): number => (points * dpi) / 72;

export type RenderPdfPageOptions = {
  pdfPath: string;
  page: number;
  dpi?: number;
  outputPath: string;
  /** Restricts writes to this directory. Defaults to the output's own dir. */
  allowedRoot?: string;
  /** Optional crop, in PDF points (top-left origin, as produced by pdfGeometry). */
  crop?: { x0: number; y0: number; x1: number; y1: number };
};

/**
 * Renders one PDF page to PNG using argument arrays only (never a shell
 * string), so paths containing spaces are safe.
 */
export const renderPdfPage = async (opts: RenderPdfPageOptions): Promise<RasterizedPage> => {
  const { pdfPath, page } = opts;
  const dpi = opts.dpi ?? 220;
  assertPage(page);
  assertDpi(dpi);
  // Validate the destination before touching the filesystem or spawning.
  const outPath = assertOutputPath(opts.outputPath, opts.allowedRoot ?? dirname(resolve(opts.outputPath)));
  if (!existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);
  mkdirSync(dirname(outPath), { recursive: true });

  const found = discoverRasterizer();
  if (!found) {
    throw new Error(
      `${PDF_RASTERIZER_NOT_AVAILABLE}: install Poppler (pdftoppm) or MuPDF (mutool) and ensure it is on PATH`,
    );
  }

  if (found.kind === "pdftoppm") {
    const prefix = outPath.replace(/\.png$/i, "");
    const args = ["-f", String(page), "-l", String(page), "-r", String(dpi), "-png"];
    if (opts.crop) {
      // pdftoppm crops in pixels, measured from the top-left of the page.
      const x = Math.round(pdfPointsToPixels(opts.crop.x0, dpi));
      const y = Math.round(pdfPointsToPixels(opts.crop.y0, dpi));
      const w = Math.round(pdfPointsToPixels(opts.crop.x1 - opts.crop.x0, dpi));
      const h = Math.round(pdfPointsToPixels(opts.crop.y1 - opts.crop.y0, dpi));
      args.push("-x", String(x), "-y", String(y), "-W", String(w), "-H", String(h));
    }
    args.push(pdfPath, prefix);
    await execFileAsync(found.bin, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    const produced = `${prefix}-${String(page).padStart(2, "0")}.png`;
    if (!existsSync(produced)) throw new Error(`pdftoppm produced no output for page ${page}`);
    return {
      page,
      dpi,
      outputPath: produced,
      widthPx: opts.crop ? Math.round(pdfPointsToPixels(opts.crop.x1 - opts.crop.x0, dpi)) : 0,
      heightPx: opts.crop ? Math.round(pdfPointsToPixels(opts.crop.y1 - opts.crop.y0, dpi)) : 0,
      rasterizer: "pdftoppm",
    };
  }

  // mutool: -r resolution, -o output, page selector "page"
  const args = ["draw", "-r", String(dpi), "-o", outPath, pdfPath, String(page)];
  await execFileAsync(found.bin, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (!existsSync(outPath)) throw new Error(`mutool produced no output for page ${page}`);
  return { page, dpi, outputPath: outPath, widthPx: 0, heightPx: 0, rasterizer: "mutool" };
};

/** Reads PNG dimensions from the IHDR chunk without a decoding dependency. */
export const readPngSize = (filePath: string): { width: number; height: number } | null => {
  try {
    const fd = openSync(filePath, "r");
    const buf = Buffer.alloc(24);
    readSync(fd, buf, 0, 24, 0);
    closeSync(fd);
    if (buf.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    try {
      const b = readFileSync(filePath);
      if (b.toString("ascii", 1, 4) !== "PNG") return null;
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    } catch {
      return null;
    }
  }
};

export const removeIfExists = (p: string) => {
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* ignore */
  }
};

/* ------------------------------------------------------------------ */
/* raster occupancy profile                                            */
/* ------------------------------------------------------------------ */

export type RowProfile = {
  /** One entry per analysed row: true when the row contains non-white ink. */
  occupied: boolean[];
  /** PDF points represented by one profile row. */
  pointsPerRow: number;
  /** Profile row -> PDF point (top-left origin), for coordinate mapping. */
  rowToPoints: (row: number) => number;
  pointsToRow: (points: number) => number;
  widthPx: number;
  heightPx: number;
};

const PROFILE_TARGET_WIDTH = 500;

/**
 * Builds a per-row "has ink" profile from a rendered page.
 *
 * Text geometry alone cannot find whitespace separators, because a question's
 * medical image contributes no text spans — so the largest text-only gap would
 * cut straight through the middle of the image. Sampling the rendered raster
 * sees text AND imagery, which is what the separator logic actually needs.
 */
export const readPageRowProfile = async (pngPath: string, dpi = 220): Promise<RowProfile> => {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(pngPath).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const outW = Math.max(1, Math.min(PROFILE_TARGET_WIDTH, srcW));
  const outH = Math.max(1, Math.round((outW / srcW) * srcH));

  const { data, info } = await sharp(pngPath)
    .resize(outW, outH, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const occupied: boolean[] = new Array(info.height).fill(false);
  // A row counts as occupied when it holds a meaningful number of dark pixels,
  // which tolerates antialiasing and noise without missing thin leader lines.
  const darkNeeded = Math.max(2, Math.floor(info.width * 0.004));
  for (let y = 0; y < info.height; y++) {
    let dark = 0;
    const base = y * info.width;
    for (let x = 0; x < info.width; x++) {
      if (data[base + x] < 200) dark++;
      if (dark >= darkNeeded) break;
    }
    occupied[y] = dark >= darkNeeded;
  }

  // The PNG is `dpi` DPI, so the page is srcH * 72/di PDF points tall. Each
  // profile row therefore spans (pagePoints / outH) points.
  const pagePoints = (srcH * 72) / dpi;
  const pointsPerRow = pagePoints / info.height;
  return {
    occupied,
    pointsPerRow,
    rowToPoints: (row) => row * pointsPerRow,
    pointsToRow: (points) => Math.floor(points / pointsPerRow),
    widthPx: srcW,
    heightPx: srcH,
  };
};

/**
 * Finds the whitespace separator ABOVE a question header.
 *
 * A question's own medical visual frequently extends above its caption, so
 * starting the block at the header clips the top of the image. This walks up
 * from the header to the nearest blank band and starts the block just below it.
 */
export const findQuestionTopY = (profile: RowProfile, headerY: number, pageTop = 0): SeparatorResult => {
  const headerRow = Math.max(0, Math.min(profile.occupied.length, profile.pointsToRow(headerY)));
  const topRow = Math.max(0, profile.pointsToRow(pageTop));

  let runEnd = -1;
  let bestLen = 0;
  let bestEnd = -1;
  for (let r = headerRow - 1; r >= topRow; r--) {
    if (!profile.occupied[r]) {
      if (runEnd < 0) runEnd = r;
    } else {
      if (runEnd >= 0) {
        const len = runEnd - r;
        if (len > bestLen) {
          bestLen = len;
          bestEnd = r;
        }
      }
      runEnd = -1;
    }
  }

  if (bestEnd < 0 || bestLen <= 0) {
    return { separatorY: pageTop, confidence: 0, reason: "no blank band above header; using page top", gapPoints: 0 };
  }
  const topY = profile.rowToPoints(bestEnd + 1);
  return {
    separatorY: topY,
    confidence: Math.min(1, bestLen / 40),
    reason: `nearest blank band above header is ${(bestLen * profile.pointsPerRow).toFixed(1)}pt tall`,
    gapPoints: bestLen * profile.pointsPerRow,
  };
};

export type SeparatorResult = {
  separatorY: number;
  confidence: number;
  reason: string;
  /** Widest whitespace run found inside the searched span, in PDF points. */
  gapPoints: number;
};

/**
 * Finds the whitespace separator between two vertically stacked questions.
 *
 * The boundary must fall BEFORE the next question's first visual, which often
 * sits ABOVE the next question's text header (image on top, caption below).
 * Cutting at the next header therefore always leaks the next question's image.
 */
export const findQuestionSeparatorY = (
  profile: RowProfile,
  currentHeaderY: number,
  nextHeaderY: number,
): SeparatorResult => {
  const startRow = Math.max(0, profile.pointsToRow(currentHeaderY));
  const endRow = Math.min(profile.occupied.length, profile.pointsToRow(nextHeaderY));
  if (endRow <= startRow) {
    return { separatorY: nextHeaderY, confidence: 0, reason: "no span between headers", gapPoints: 0 };
  }

  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  // The separator row itself must stay blank, so the run is measured on empty
  // rows only and a run touching the next header is rejected.
  for (let r = startRow; r < endRow; r++) {
    if (!profile.occupied[r]) {
      if (runStart < 0) runStart = r;
    } else {
      if (runStart >= 0) {
        const len = r - runStart;
        if (len > bestLen) {
          bestLen = len;
          bestStart = runStart;
        }
      }
      runStart = -1;
    }
  }

  if (bestStart < 0 || bestLen <= 0) {
    return {
      separatorY: nextHeaderY,
      confidence: 0,
      reason: "no whitespace run found; fell back to next header",
      gapPoints: 0,
    };
  }

  const mid = bestStart + Math.floor(bestLen / 2);
  return {
    separatorY: profile.rowToPoints(mid),
    confidence: Math.min(1, bestLen / 40),
    reason: `largest blank run of ${(bestLen * profile.pointsPerRow).toFixed(1)}pt between headers`,
    gapPoints: bestLen * profile.pointsPerRow,
  };
};

