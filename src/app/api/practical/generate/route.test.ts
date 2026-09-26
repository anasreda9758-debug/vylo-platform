import { beforeEach, describe, expect, it, vi } from "vitest";

type SqlObj = { query: string; values: unknown[] };

const mem = vi.hoisted(() => {
  type Req = { status: string; resultJson: string | null };
  const store = new Map<string, Req>();
  const keyOf = (u: string, k: string) => `${u}|${k}`;
  const parse = (s: unknown): SqlObj => {
    const o = s as { queryChunks?: unknown[] };
    if (o && Array.isArray(o.queryChunks)) {
      const frags: string[] = [];
      const values: unknown[] = [];
      for (const c of o.queryChunks) {
        const anyC = c as { value?: unknown };
        if (anyC && typeof anyC === "object" && Array.isArray(anyC.value)) {
          frags.push((anyC.value as unknown[]).join(""));
        } else {
          values.push(c);
          frags.push(`$${values.length}`);
        }
      }
      return { query: frags.join(""), values };
    }
    const raw = s as SqlObj;
    return { query: String(raw.query ?? raw), values: raw.values ?? [] };
  };
  const inserted: unknown[] = [];
  const exec = (s: unknown): unknown[] => {
    const { query, values } = parse(s);
    if (query.includes("SELECT status, result_json FROM ai_generation_request")) {
      const [user, key] = values as [string, string];
      const row = store.get(keyOf(user, key));
      return row ? [{ status: row.status, result_json: row.resultJson }] : [];
    }
    if (query.includes("INSERT INTO ai_generation_request")) {
      const [key, user] = values as [string, string, string];
      store.set(keyOf(user, key), { status: "pending", resultJson: null });
      return [];
    }
    if (query.includes("UPDATE ai_generation_request")) {
      const [status, resultJson, , user, key] = values as [string, string | null, Date | null, string, string];
      store.set(keyOf(user, key), { status, resultJson });
      return [];
    }
    throw new Error(`unexpected sql: ${query}`);
  };
  return {
    db: {
      execute: async (s: unknown) => exec(s),
      query: {
        practicalImage: { findFirst: vi.fn() },
        practicalTrack: { findFirst: vi.fn() },
      },
      insert: () => ({
        values: async (v: unknown) => {
          inserted.push(v);
          return {};
        },
      }),
    },
    seed: (user: string, key: string, status: Req["status"], resultJson: string | null = null) =>
      store.set(keyOf(user, key), { status, resultJson }),
    inserted,
    reset: () => {
      store.clear();
      inserted.length = 0;
    },
  };
});

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  reserve: vi.fn(),
  record: vi.fn(),
  generate: vi.fn(),
  moduleAccess: vi.fn(),
}));

vi.mock("@/shared/db", () => ({ db: mem.db }));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/ai/queries", () => ({
  reserveAiUsageSlot: mocks.reserve,
  recordAiUsage: mocks.record,
  FREE_DAILY_LIMIT: 15,
}));
vi.mock("@/shared/ai-client", () => ({ generateJson: mocks.generate }));
vi.mock("@/features/access/learning-access", () => ({
  getAccessibleModuleBySlug: mocks.moduleAccess,
}));

import { POST } from "./route";

const SOURCE = {
  id: "img-src-1",
  moduleId: "module-1",
  studyYear: 4,
  subject: "Anatomy",
  alt: "Cross-section of the heart at the level of the mitral valve",
  sourcePage: 12,
  trackId: "track-1",
};

const VALID_AI = {
  prompt: "What is the structure indicated by the arrow?",
  options: ["Mitral valve", "Tricuspid valve", "Aortic valve", "Pulmonary valve", "Left atrium"],
  correctOptionId: "Mitral valve",
  explanation: "The bicuspid valve is located between the left atrium and ventricle.",
  identifyingClue: "Two visible cusps",
  commonMistake: "Confusing with the tricuspid valve",
  examTip: "Look at the papillary muscles insertion",
};

function request(body: unknown) {
  return new Request("http://localhost/api/practical/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = (overrides: Record<string, unknown> = {}) => ({
  sourceImageId: "img-src-1",
  targetX: 0.42,
  targetY: 0.67,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user-1", role: "student" } });
  mocks.reserve.mockResolvedValue({ ok: true, count: 1 });
  mocks.moduleAccess.mockResolvedValue({ ok: true });
  mocks.generate.mockResolvedValue({
    data: VALID_AI,
    inputTokens: 100,
    outputTokens: 80,
  });
  (mem.db.query.practicalImage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ ...SOURCE });
  (mem.db.query.practicalTrack.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "track-1" });
  mem.reset();
});

describe("POST /api/practical/generate", () => {
  it("generates a derivative image + 5-option question with preserved source and coordinates", async () => {
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ duplicate: false });
    expect(typeof body.questionId).toBe("string");
    expect(typeof body.examImageId).toBe("string");

    const [image, question] = mem.inserted as Record<string, unknown>[];
    // derivative image: preserves the source + coordinates, linked to source
    expect(image).toMatchObject({
      sourceImageId: "img-src-1",
      targetX: 0.42,
      targetY: 0.67,
      isExamDerivative: true,
      generationStatus: "COMPLETED",
      reviewStatus: "APPROVED",
      generatedByAi: true,
      moduleId: "module-1",
      studyYear: 4,
      examImageId: null,
    });
    // question references the derivative image, keeps coordinates, exactly 5 options
    expect(question).toMatchObject({
      questionType: "IMAGE_IDENTIFICATION",
      answerFormat: "SINGLE_CHOICE",
      imageId: image.id,
      sourceImageId: "img-src-1",
      examImageId: image.id,
      targetX: 0.42,
      targetY: 0.67,
      generationRequestId: validBody().idempotencyKey,
      generationStatus: "COMPLETED",
      status: "APPROVED",
    });
    const q = question as { options: { id: string; text: string }[]; correctOptionId: string };
    expect(q.options.length).toBe(5);
    expect(q.options.map((o) => o.id)).toContain(q.correctOptionId);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });

  it("never leaks the answer to the student response (only ids are returned)", async () => {
    const response = await POST(request(validBody()));
    const body = await response.json();
    expect(body).not.toHaveProperty("options");
    expect(body).not.toHaveProperty("correctOptionId");
    expect(body).not.toHaveProperty("prompt");
    expect(body).not.toHaveProperty("explanation");
  });

  it("shares the study-generation quota and rejects when exhausted", async () => {
    mocks.reserve.mockResolvedValue({ ok: false, reason: "limit_reached" });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(429);
    expect(mem.inserted.length).toBe(0);
  });

  it("rejects out-of-range target coordinates (400)", async () => {
    const response = await POST(request(validBody({ targetX: 5 })));
    expect(response.status).toBe(400);
    expect(mem.inserted.length).toBe(0);
  });

  it("rejects a payload with fewer than 5 options (no half question created)", async () => {
    mocks.generate.mockResolvedValue({
      data: { ...VALID_AI, options: ["A", "B", "C", "D"] },
      inputTokens: 10,
      outputTokens: 5,
    });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(500);
    expect(mem.inserted.length).toBe(0);
  });

  it("reusing a completed idempotency key replays the stored result without re-generating", async () => {
    const first = await POST(request(validBody()));
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(mem.inserted.length).toBe(2);

    const second = await POST(request(validBody()));
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toMatchObject({ questionId: firstBody.questionId, examImageId: firstBody.examImageId, duplicate: true });
    // no second generation, no second insert, no second quota charge
    expect(mem.inserted.length).toBe(2);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("does not let a different user replay another user's completed result", async () => {
    await POST(request(validBody())); // user-1 completes it
    mocks.session.mockResolvedValue({ user: { id: "user-2", role: "student" } });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    expect(mem.inserted.length).toBe(4); // user-2 gets a fresh generation
  });

  it("requires authentication", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await POST(request(validBody()));
    expect(response.status).toBe(401);
  });
});