import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => {
  const questions = [
    { id: "q1", questionType: "IMAGE_IDENTIFY_STRUCTURE", reviewStatus: "AUTO_VERIFIED_SOURCE", status: "DRAFT_AI", prompt: "Identify Psoas major", sourceMaterial: { pdf: "OSPE RENAL.pdf", page: 2 }, sourcePage: 2, imageId: "img1", groupId: "g1", order: 1, correctOptionId: "opt1" },
    { id: "q2", questionType: "IMAGE_RELATED_STRUCTURE", reviewStatus: "NEEDS_REVIEW", status: "DRAFT_AI", prompt: "Identify related structure", sourceMaterial: { pdf: "OSPE RENAL.pdf", page: 5 }, sourcePage: 5, imageId: "img2", groupId: "g2", order: 2, correctOptionId: "opt2" },
  ];
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(async () => questions),
        })),
      })),
      query: { practicalQuestion: { findFirst: vi.fn(async ({ where }: { where: unknown }) => questions.find((q) => q.id === (where as { id: string }).id)) } },
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => {}) })), where: vi.fn(async () => {}) })),
    },
    questions,
    reset: () => { questions.length = 0; },
  };
});

vi.mock("@/shared/session", () => ({
  requireAdmin: vi.fn(async () => ({ user: { role: "admin" } })),
  requireAdminApi: async () => ({ session: { user: { role: "admin" } }, error: null }),
}));
vi.mock("@/shared/db", () => ({ db: mem.db }));

import { GET, POST } from "./route";

describe("admin practical-review route", () => {
  beforeEach(() => {
    (mem.db.query.practicalQuestion.findFirst as ReturnType<typeof vi.fn>).mockReset();
  });

  it("GET returns questions ordered", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.questions.length).toBe(2);
    expect(json.questions[0].reviewStatus).toBe("AUTO_VERIFIED_SOURCE");
  });

  it("POST approve transitions AUTO_VERIFIED_SOURCE to APPROVED", async () => {
    (mem.db.query.practicalQuestion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mem.questions[0]);
    const res = await POST({ json: async () => ({ questionId: "q1", action: "approve" }) } as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect((await res.json()).reviewStatus).toBe("APPROVED");
  });

  it("POST reject transitions NEEDS_REVIEW to REJECTED", async () => {
    (mem.db.query.practicalQuestion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mem.questions[1]);
    const res = await POST({ json: async () => ({ questionId: "q2", action: "reject" }) } as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect((await res.json()).reviewStatus).toBe("REJECTED");
  });

  it("POST cannot_approve on DRAFT returns 409", async () => {
    (mem.db.query.practicalQuestion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "q3", reviewStatus: "DRAFT" });
    const res = await POST({ json: async () => ({ questionId: "q3", action: "approve" }) } as unknown as NextRequest);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("cannot_approve");
  });

  it("POST not_found returns 404", async () => {
    (mem.db.query.practicalQuestion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST({ json: async () => ({ questionId: "q9", action: "approve" }) } as unknown as NextRequest);
    expect(res.status).toBe(404);
  });
});
