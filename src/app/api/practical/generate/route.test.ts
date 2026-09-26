import { beforeEach, describe, expect, it, vi } from "vitest";

type SqlObj = { query: string; values: unknown[] };

const mem = vi.hoisted(() => {
  type Req = { status: string; resultJson: string | null; feature: string | null; trackId: string | null };
  const store = new Map<string, Req>();
  const ai = new Map<string, number>();
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
    if (query.includes("SELECT count FROM ai_usage_daily")) {
      const [user] = values as [string];
      return [{ count: ai.get(user) ?? 0 }];
    }
    if (query.includes("SELECT id FROM ai_generation_request")) {
      const [user, key] = values as [string, string];
      const row = store.get(keyOf(user, key));
      return row ? [{ id: `req-${key}` }] : [];
    }
    if (query.includes("FROM ai_generation_request")) {
      const [user, key] = values as [string, string];
      const row = store.get(keyOf(user, key));
      return row
        ? [{ id: `req-${key}`, status: row.status, result_json: row.resultJson, feature: row.feature, lecture_id: null, practical_track_id: row.trackId }]
        : [];
    }
    if (query.includes("INSERT INTO ai_generation_request")) {
      const [, key, user, feature, lectureId, trackId] = values as [string, string, string, string, string | null, string | null];
      store.set(keyOf(user, key), { status: "pending", resultJson: null, feature, trackId });
      return [];
    }
    if (query.includes("UPDATE ai_generation_request")) {
      const [status, resultJson, , user, key] = values as [string, string | null, Date | null, string, string];
      const row = store.get(keyOf(user, key));
      store.set(keyOf(user, key), { ...(row ?? { status: "pending", resultJson: null, feature: null, trackId: null }), status, resultJson });
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
    seed: (user: string, key: string, status: Req["status"], trackId: string | null, feature = "practical") =>
      store.set(keyOf(user, key), { status, resultJson: null, feature, trackId }),
    seedAi: (user: string, count: number) => ai.set(user, count),
    inserted,
    reset: () => {
      store.clear();
      ai.clear();
      inserted.length = 0;
    },
  };
});

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  reserve: vi.fn(),
  usedToday: vi.fn(),
  record: vi.fn(),
  generate: vi.fn(),
  moduleAccess: vi.fn(),
}));

vi.mock("@/shared/db", () => ({ db: mem.db }));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/ai/queries", () => ({
  reserveAiUsageSlot: mocks.reserve,
  getAiUsageToday: mocks.usedToday,
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
  alt: "Histology slide of the lung showing a bronchiola and alveoli",
  sourcePage: 12,
  trackId: "track-1",
  storageKey: "anatomy/histology-lung-label.png",
};

const CLEAN = {
  id: "img-clean-9",
  moduleId: "module-1",
  studyYear: 4,
  subject: "Anatomy",
  alt: "Histology slide of the lung (labels removed)",
  sourcePage: 12,
  trackId: "track-1",
  storageKey: "anatomy/histology-lung-clean.png",
};

const whereId = (where: unknown): string | null => {
  const o = where && typeof where === "object" ? (where as { queryChunks?: unknown[] }) : undefined;
  if (!o || !Array.isArray(o.queryChunks)) return null;
  for (const c of o.queryChunks) {
    const anyC = c as { value?: unknown };
    // eq() chunks a column (PgText) plus a Param {value}; the id is the Param's value.
    if (c && typeof c === "object" && !Array.isArray(anyC.value) && typeof anyC.value === "string") {
      return anyC.value;
    }
  }
  return null;
};

const images = new Map<string, (typeof SOURCE) | null>();
const tracks = new Map<string, { id: string }>();

const DISTRACTORS = {
  distractors: ["Bronchiole smooth muscle", "Alveolar macrophage", "Pulmonary vein", "Respiratory bronchiole"],
  explanation: "The bronchial cartilage ring marks the primary bronchus.",
  identifyingClue: "C-shaped cartilage",
  commonMistake: "Confusing the bronchus with the bronchiole",
  examTip: "Look for cartilage to find the bronchus",
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
  correctStructure: "Primary bronchus",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  ...overrides,
});

let currentSource: (typeof SOURCE) | null = SOURCE;

beforeEach(() => {
  vi.resetAllMocks();
  currentSource = { ...SOURCE };
  images.clear();
  tracks.clear();
  images.set("img-src-1", { ...SOURCE });
  images.set("img-clean-9", { ...CLEAN });
  tracks.set("track-1", { id: "track-1" });
  tracks.set("track-2", { id: "track-2" });
  mocks.session.mockResolvedValue({ user: { id: "user-1", role: "student" } });
  mocks.reserve.mockResolvedValue({ ok: true, count: 1 });
  mocks.usedToday.mockResolvedValue(0);
  mocks.moduleAccess.mockResolvedValue({ ok: true });
  mocks.generate.mockResolvedValue({
    data: DISTRACTORS,
    inputTokens: 100,
    outputTokens: 80,
  });
  (mem.db.query.practicalImage.findFirst as ReturnType<typeof vi.fn>).mockImplementation(async (args: unknown) => {
    const id = whereId((args as { where: unknown }).where);
    if (!currentSource) return null;
    if (currentSource.id === id) return currentSource;
    return images.get(id ?? "") ?? null;
  });
  // The track is resolved via a callback-where; derive it from the current source.
  (mem.db.query.practicalTrack.findFirst as ReturnType<typeof vi.fn>).mockImplementation(async () =>
    currentSource ? { id: currentSource.trackId ?? "track-1" } : { id: "track-1" },
  );
  mem.reset();
});

describe("POST /api/practical/generate - authoring", () => {
  it("creates a hidden DRAFT question: verified answer is opt_0, exactly 5 options, never auto-published", async () => {
    // A clean EXAM image is provided, so the artifact can be a complete DRAFT.
    const response = await POST(request(validBody({ examImageId: "img-clean-9" })));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reviewStatus).toBe("DRAFT");

    const [question] = mem.inserted as Record<string, unknown>[];
    // only the question is inserted — the clean exam image already existed
    expect(mem.inserted.length).toBe(1);
    // the AI never decides the correct answer
    const opts = question.options as { id: string; text: string }[];
    expect(opts.length).toBe(5);
    expect(opts[0].text).toBe("Primary bronchus");
    expect(question.correctOptionId).toBe("opt_0");
    expect(question.correctStructure).toBe("Primary bronchus");
    expect(question.status).toBe("DRAFT_AI"); // hidden, needs explicit admin approval
    expect(question.reviewStatus).toBe("DRAFT");
    // the student-visible image is the CLEAN exam version, never the labeled source
    expect(question.imageId).toBe("img-clean-9");
    expect(question.examImageId).toBe("img-clean-9");
    expect(question.sourceImageId).toBe("img-src-1");
  });

  it("missing clean exam image: creates a hidden pending derivative and the artifact is NEEDS_REVIEW", async () => {
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reviewStatus).toBe("NEEDS_REVIEW");

    const [derivative, question] = mem.inserted as Record<string, unknown>[];
    // pending clean derivative links to the source but is NOT approved
    expect(derivative).toMatchObject({
      isExamDerivative: true,
      sourceImageId: "img-src-1",
      reviewStatus: "NEEDS_REVIEW",
      status: "DRAFT_AI",
      targetX: 0.42,
      targetY: 0.67,
    });
    // the auto-created derivative has no uploaded file yet (empty storage key) so
    // it can never pass the approval gate until an admin uploads the clean image
    expect(derivative.storageKey).toBe("");
    // question points students at the pending exam derivative, never the labeled source
    expect(question.imageId).toBe(derivative.id);
    expect(question.examImageId).toBe(derivative.id);
    expect(question.sourceImageId).toBe("img-src-1");
    expect(question.status).toBe("DRAFT_AI");
    expect(question.reviewStatus).toBe("NEEDS_REVIEW");
  });

  it("rejects duplicate/blank distractor suggestions: fewer than 5 options -> NEEDS_REVIEW", async () => {
    mocks.generate.mockResolvedValue({
      data: { distractors: ["Primary bronchus", "Primary bronchus", "Bronchiole", "", "Bronchiole"], explanation: "x" },
      inputTokens: 10,
      outputTokens: 5,
    });
    // clean exam image provided, so NEEDS_REVIEW is driven by the bad distractors
    const response = await POST(request(validBody({ examImageId: "img-clean-9" })));
    expect(response.status).toBe(200);
    const [question] = mem.inserted as Record<string, unknown>[];
    const opts = question.options as { id: string; text: string }[];
    expect(opts.length).toBeLessThan(5);
    expect(question.reviewStatus).toBe("NEEDS_REVIEW");
  });

  it("missing verified answer: AI is NEVER called, artifact is NEEDS_REVIEW, and no quota is consumed", async () => {
    const response = await POST(request(validBody({ correctStructure: "" })));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reviewStatus).toBe("NEEDS_REVIEW");
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    const [, question] = mem.inserted as Record<string, unknown>[];
    expect(question.correctStructure).toBeNull();
    expect(question.reviewStatus).toBe("NEEDS_REVIEW");
  });

  it("missing clean exam image -> NEEDS_REVIEW and cannot be approved (approve gate later blocks it)", async () => {
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    // the auto-created derivative has an empty storage key
    const [derivative] = mem.inserted as Record<string, unknown>[];
    expect(derivative.storageKey).toBe("");
    expect(derivative.reviewStatus).toBe("NEEDS_REVIEW");
  });

  it("rejects out-of-range target coordinates (400)", async () => {
    const response = await POST(request(validBody({ targetX: 5 })));
    expect(response.status).toBe(400);
    expect(mem.inserted.length).toBe(0);
  });

  it("shares the study-generation quota and charges only on success", async () => {
    // pre-flight at 14: success consumes the 15th slot
    mocks.usedToday.mockResolvedValue(14);
    const ok = await POST(request(validBody()));
    expect(ok.status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    // pre-flight already at the limit: 429 before any generation
    mocks.usedToday.mockResolvedValue(15);
    const rejected = await POST(request(validBody({ idempotencyKey: "22222222-2222-4222-8222-222222222222" })));
    expect(rejected.status).toBe(429);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("a failed AI generation consumes NO quota and stores a failed request", async () => {
    mocks.generate.mockRejectedValue(new Error("api down"));
    const response = await POST(request(validBody()));
    expect(response.status).toBe(500);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mem.inserted.length).toBe(0);
  });

  it("reusing a completed idempotency key replays the stored result without re-generating", async () => {
    const first = await POST(request(validBody()));
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    const second = await POST(request(validBody()));
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toMatchObject({ questionId: firstBody.questionId, examImageId: firstBody.examImageId, duplicate: true });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mem.inserted.length).toBe(2);
  });

  it("does not let a different user replay another user's completed key (user-scoped idempotency)", async () => {
    await POST(request(validBody())); // user-1 completes it
    mocks.session.mockResolvedValue({ user: { id: "user-2", role: "student" } });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    expect(mem.inserted.length).toBe(4); // user-2 gets a fresh generation
  });

  it("same user reusing a key for a DIFFERENT source (other track) is a 409 conflict", async () => {
    const first = await POST(request(validBody()));
    expect(first.status).toBe(200);
    // the same key now targets a different source image that belongs to another track
    currentSource = { ...SOURCE, id: "img-src-2", trackId: "track-2", alt: "Another section" };
    const second = await POST(request(validBody({ sourceImageId: "img-src-2" })));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toBe("idempotency_key_already_used_for_different_request");
  });

  it("returns 404 when the source image is missing and 403 without module access", async () => {
    currentSource = null;
    const missing = await POST(request(validBody()));
    expect(missing.status).toBe(404);

    currentSource = { ...SOURCE };
    mocks.moduleAccess.mockResolvedValue({ ok: false });
    const forbidden = await POST(request(validBody({ idempotencyKey: "33333333-3333-4333-8333-333333333333" })));
    expect(forbidden.status).toBe(403);
  });

  it("requires authentication", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await POST(request(validBody()));
    expect(response.status).toBe(401);
  });
});