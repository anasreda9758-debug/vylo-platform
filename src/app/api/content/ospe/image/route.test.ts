import { PassThrough } from "node:stream";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  moduleAccess: vi.fn(),
  answerKeyRow: vi.fn(),
  resolve: vi.fn(),
  stat: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/ospe/queries", () => ({ getOspeModuleAccess: mocks.moduleAccess }));
vi.mock("@/features/ospe/data", () => ({
  OSPE_IMAGE_MIME: { ".png": "image/png" },
  resolveOspeImage: mocks.resolve,
}));
vi.mock("@/features/ospe/schema", () => ({ ospeAnswerKey: { id: "id" } }));
vi.mock("@/shared/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.answerKeyRow }) }) }),
  },
}));
vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));
vi.mock("node:fs", () => ({ createReadStream: mocks.createReadStream }));

import { GET } from "./route";

const req = (folder: string | null, file: string | null) => {
  const q = new URLSearchParams();
  if (folder) q.set("folder", folder);
  if (file) q.set("file", file);
  return new NextRequest(`http://localhost/api/content/ospe/image?${q.toString()}`);
};

describe("GET /api/content/ospe/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "student-a", role: "student" } });
    mocks.moduleAccess.mockResolvedValue([{ folder: "renal", locked: false }]);
    mocks.answerKeyRow.mockResolvedValue([{ id: "station-1" }]);
    mocks.resolve.mockReturnValue("C:/ospe/renal/RENAL-101.png");
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 4 });
    const stream = new PassThrough();
    stream.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    mocks.createReadStream.mockReturnValue(stream);
  });

  it("denies anonymous callers", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await GET(req("renal", "RENAL-101.png"));
    expect(res.status).toBe(401);
  });

  it("rejects missing folder/file params", async () => {
    const res = await GET(req(null, "RENAL-101.png"));
    expect(res.status).toBe(400);
  });

  it("rejects unknown folders", async () => {
    const res = await GET(req("cardio", "X.png"));
    expect(res.status).toBe(404);
  });

  it("blocks locked folders with premium-required", async () => {
    mocks.moduleAccess.mockResolvedValue([{ folder: "renal", locked: true }]);
    const res = await GET(req("renal", "RENAL-101.png"));
    expect(res.status).toBe(403);
  });

  it("never serves a file whose (folder,file) pair is not on the reviewed answer key", async () => {
    mocks.answerKeyRow.mockResolvedValue([]);
    const res = await GET(req("renal", "not-reviewed.png"));
    expect(res.status).toBe(404);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("serves reviewed station images with nosniff", async () => {
    const res = await GET(req("renal", "RENAL-101.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = [...new Uint8Array(await res.arrayBuffer())];
    expect(bytes).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});