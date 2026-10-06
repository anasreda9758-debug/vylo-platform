import { readdir } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { getContentRoot } from "@/shared/content";

export const OSPE_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

export const OSPE_IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const OSPE_FOLDER_TO_MODULE: Record<string, string> = {
  "module 1": "ahe-101",
  "module 2": "ppg-102",
  "module 3": "pmb-103",
  RESP: "rs-201",
  CVS: "cvs-202",
  RENAL: "rau-203",
  IBL: "ibl-204",
};

/**
 * These files currently live in `public/ospe-pdfs` for local content storage.
 * They are served only through the authenticated API route; direct public URLs
 * are blocked by `src/proxy.ts`.
 */
export const OSPE_PDF_REFERENCES = [
  { name: "OSPE CVS", file: "OSPE CVS.pdf", size: "80 MB", folder: "CVS" },
  { name: "OSPE IBL", file: "OSPE IBL.pdf", size: "18 MB", folder: "IBL" },
  { name: "Module 1 — Sites & Stains", file: "Ospe module 1 مع sites & stains.pdf", size: "4.3 MB", folder: "module 1" },
  { name: "Module 2 — EB", file: "Ospe module 2 EB.pdf", size: "2.7 MB", folder: "module 2" },
  { name: "Module 3", file: "Ospe module 3.pdf", size: "12 MB", folder: "module 3" },
  { name: "OSPE RENAL (1)", file: "OSPE RENAL.pdf", size: "43 MB", folder: "RENAL" },
  { name: "OSPE RENAL (2)", file: "OSPE RENAL.pdf-1.pdf", size: "27 MB", folder: "RENAL" },
] as const;

export function getOspePdfReference(file: string) {
  return OSPE_PDF_REFERENCES.find((reference) => reference.file === file) ?? null;
}

export function getImagesRoot(): string {
  return join(getContentRoot(), "images");
}

export function resolveOspeImage(folder: string, file: string): string | null {
  const imagesRoot = getImagesRoot();
  const target = normalize(join(imagesRoot, folder, file));
  if (target !== imagesRoot && !target.startsWith(imagesRoot + sep)) return null;
  return target;
}

export async function listImagesInFolder(folder: string): Promise<string[]> {
  const dir = join(getImagesRoot(), folder);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => {
      if (!e.isFile()) return false;
      const lower = e.name.toLowerCase();
      return OSPE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
    })
    .map((e) => e.name)
    .sort();
}

export async function listOspeFolders(): Promise<{ folder: string; count: number }[]> {
  const entries = await readdir(getImagesRoot(), { withFileTypes: true }).catch(() => []);
  const out: { folder: string; count: number }[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !(e.name in OSPE_FOLDER_TO_MODULE)) continue;
    const files = await listImagesInFolder(e.name);
    out.push({ folder: e.name, count: files.length });
  }
  return out;
}
