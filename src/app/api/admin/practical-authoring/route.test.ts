import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => {
  const inserted: unknown[] = [];
  const written: string[] = [];
  return {
    db: {
      query: {
        practicalImage: { findFirst: vi.fn() },
      },
      insert: () => ({
        values: async (v: unknown) => {
          inserted.push(v);
          return {};
        },
      }),
    },
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    inserted,
    written,
    reset: () => {
      inserted.length = 0;
      written.length = 0;
    },
  };
});

vi.mock("@/shared/session", () => ({
  requireAdmin: vi.fn(async () => ({ user: { role: "admin" } })),
  requireAdminApi: async () => ({ session: { user: { role: "admin" } }, error: null }),
}));
vi.mock("@/shared/db", () => ({ db: mem.db }));
vi.mock("node:fs/promises", () => ({ writeFile: mem.writeFile, mkdir: mem.mkdir }));

import { PATCH } from "./route";

const whereId = (where: unknown): string | null => {
  const o = where && typeof where === "object" ? (where as { queryChunks?: unknown[] }) : undefined;
  if (!o || !Array.isArray(o.queryChunks)) return null;
  for (const c of o.queryChunks) {
    const anyC = c as { value?: unknown };
    if (c && typeof c === "object" && !Array.isArray(anyC.value) && typeof anyC.value === "string") {
      return anyC.value;
    }
  }
  return null;
};

const SOURCE = {
  id: "img-src-1",
  trackId: "track-1",
  moduleId: "module-1",
  studyYear: 4,
  subject: "Anatomy",
  storageKey: "anatomy/lung-label.png",
  alt: "Histology slide of the lung",
  sourceMaterial: { title: "x", path: "x", sha256: "", approvedBy: null, approvedAt: null },
  sourcePage: 12,
  markers: [],
};

const upload = (overrides: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/admin/practical-authoring", {
    method: "PATCH",
    body: JSON.stringify({
      action: "upload-clean",
      sourceImageId: "img-src-1",
      filename: "clean.png",
      dataBase64: Buffer.from("iVBORw0KGgo=").toString("base64"),
      ...overrides,
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mem.reset();
  (mem.db.query.practicalImage.findFirst as ReturnType<typeof vi.fn>).mockImplementation(async (args: unknown) => {
    const id = whereId((args as { where: unknown }).where);
    if (id !== "img-src-1") return null;
    return SOURCE;
  });
});

describe("PATCH /api/admin/practical-authoring - upload-clean track binding", () => {
  it("admin-uploaded clean derivative INHERITS the source trackId (no orphan in the student catalog join)", async () => {
    const response = await PATCH(upload());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    const [derivative] = mem.inserted as Record<string, unknown>[];
    expect(derivative.trackId).toBe("track-1");
    expect(derivative).toMatchObject({
      isExamDerivative: true,
      sourceImageId: "img-src-1",
      moduleId: "module-1",
    });
    expect(mem.writeFile).toHaveBeenCalledTimes(1);
  });

  it("refuses to upload a clean image for an untracked source: no orphan derivative is created (409)", async () => {
    (mem.db.query.practicalImage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ ...SOURCE, trackId: null });
    const response = await PATCH(upload());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/no practical track/i);
    expect(mem.inserted.length).toBe(0);
    expect(mem.writeFile).not.toHaveBeenCalled();
  });

  it("returns 404 when the source image does not exist", async () => {
    (mem.db.query.practicalImage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const response = await PATCH(upload());
    expect(response.status).toBe(404);
    expect(mem.inserted.length).toBe(0);
    expect(mem.writeFile).not.toHaveBeenCalled();
  });
});