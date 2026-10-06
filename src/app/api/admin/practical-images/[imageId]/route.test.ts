import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(async () => ({ session: { user: { role: "admin", id: "owner" } }, error: null })),
  read: vi.fn(),
  dbSelect: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock("@/features/practical/images", () => ({ readPracticalImage: mocks.read }));
vi.mock("@/shared/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.dbSelect,
        }),
      }),
    }),
  },
}));
vi.mock("@/features/practical/http", () => ({
  privateHeaders: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" },
  practicalFailure: (error: Error) => new Response(JSON.stringify({ error: error instanceof Error ? error.message : "err" }), { status: 404, headers: {} }),
}));

import { GET } from "./route";

const SOURCE_ROW = {
  id: "renal-105-kidney-source-img-v1",
  trackId: "practical-track-rau-203-anatomy",
  moduleId: "renal",
  studyYear: 1,
  subject: "Anatomy",
  storageKey: "renal-105-kidney-source.png",
  alt: "Kidney (OSPE RENAL-105.png)",
  isFixture: false,
};

const EXAM_ROW = { ...SOURCE_ROW, id: "renal-105-kidney-exam-img-v1", storageKey: "renal-105-kidney-exam.png", alt: "Clean exam version of Kidney (OSPE RENAL-105.png)" };

const req = (id: string) => new Request(`http://localhost/api/admin/practical-images/${id}`);
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ bytes, mime: "image/png" });
});

describe("GET /api/admin/practical-images/[imageId]", () => {
  it("serves the SOURCE (labeled) image to an admin", async () => {
    mocks.dbSelect.mockResolvedValue([SOURCE_ROW]);
    const res = await GET(req(SOURCE_ROW.id), { params: Promise.resolve({ imageId: SOURCE_ROW.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...bytes]);
  });

  it("serves the CLEAN exam derivative to an admin", async () => {
    mocks.dbSelect.mockResolvedValue([EXAM_ROW]);
    const res = await GET(req(EXAM_ROW.id), { params: Promise.resolve({ imageId: EXAM_ROW.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("returns 404 for a nonexistent image", async () => {
    mocks.dbSelect.mockResolvedValue([]);
    const res = await GET(req("does-not-exist"), { params: Promise.resolve({ imageId: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });

  it("never uses the URL param as a filesystem path: untrusted ids are 404, storageKey comes from the DB row", async () => {
    mocks.dbSelect.mockResolvedValue([]);
    const res = await GET(req("../../etc/passwd"), { params: Promise.resolve({ imageId: "../../etc/passwd" }) });
    expect(res.status).toBe(404);
    expect(mocks.requireAdminApi).toHaveBeenCalled();
    mocks.dbSelect.mockResolvedValue([SOURCE_ROW]);
    const ok = await GET(req(SOURCE_ROW.id), { params: Promise.resolve({ imageId: SOURCE_ROW.id }) });
    expect(ok.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ storageKey: "renal-105-kidney-source.png" }));
  });

  it("nulls out an unpresented imageId (no crash, controlled 404)", async () => {
    mocks.dbSelect.mockResolvedValue([]);
    const res = await GET(req("x"), { params: Promise.resolve({ imageId: "x" }) });
    expect(res.status).toBe(404);
  });
});

describe("MIME delivery", () => {
  it("returns the bytes with a content-type security header for the exam derivative", async () => {
    const id = "renal-134-ureter-exam-img-v1";
    mocks.dbSelect.mockResolvedValue([EXAM_ROW]);
    const res = await GET(req(id), { params: Promise.resolve({ imageId: id }) });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});