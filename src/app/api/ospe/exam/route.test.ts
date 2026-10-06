import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), practicalScope: vi.fn(), create: vi.fn(), start: vi.fn(), examAccess: vi.fn(),
  folderAccess: vi.fn(), foldersAccess: vi.fn(),
}));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/practical/ospe-scope", () => ({ resolvePracticalOspeScope: mocks.practicalScope }));
vi.mock("@/features/ospe/exam", () => ({ createExam: mocks.create, startExam: mocks.start }));
vi.mock("@/features/access/learning-access", () => ({
  getAccessibleOspeExam: mocks.examAccess,
  getAccessibleOspeFolder: mocks.folderAccess,
  getAccessibleOspeFolders: mocks.foldersAccess,
}));
import { POST } from "./route";

const track = {
  id: "track-renal-anatomy", moduleId: "module-renal", moduleSlug: "rau-203", moduleName: "Renal", studyYear: 1,
  subject: "ANATOMY", subjectSlug: "anatomy", displayNameEn: "Anatomy", displayNameAr: null,
  status: "PUBLISHED", sortOrder: 0, practiceEnabled: true, ospeEnabled: true,
};

function request(moduleSlug = "rau-203", subjectSlug = "anatomy") {
  return new NextRequest("http://localhost/api/ospe/exam", { method: "POST", body: JSON.stringify({ moduleSlug, subjectSlug, stationCount: 5 }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.practicalScope.mockResolvedValue({ ok: true, value: track });
  mocks.create.mockResolvedValue("exam-1");
  mocks.start.mockResolvedValue({ examId: "exam-1" });
  mocks.folderAccess.mockResolvedValue({ ok: true, value: { folder: "RENAL" } });
  mocks.examAccess.mockResolvedValue({ ok: true, value: {
    id: "exam-1", status: "in_progress", startedAt: new Date(), stationCount: 0,
    timePerStationSec: 60, totalTimeLimitSec: 300, totalScore: null, maxPossibleScore: null, stations: [],
  } });
});

describe("subject-scoped OSPE creation", () => {
  it("binds a valid module and subject to the authoritative practical track", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.practicalScope).toHaveBeenCalledWith({ id: "owner" }, "rau-203", "anatomy");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", practicalTrackId: track.id, folder: undefined }));
  });

  it("preserves the existing folder-scoped Renal OSPE path", async () => {
    const response = await POST(new NextRequest("http://localhost/api/ospe/exam", { method: "POST", body: JSON.stringify({ folder: "RENAL", stationCount: 5 }) }));
    expect(response.status).toBe(200);
    expect(mocks.practicalScope).not.toHaveBeenCalled();
    expect(mocks.folderAccess).toHaveBeenCalledWith({ id: "owner" }, "RENAL");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", folder: "RENAL", practicalTrackId: undefined }));
  });

  it.each([
    ["wrong module", "cvs-202", "anatomy"],
    ["wrong subject", "rau-203", "histology"],
  ])("blocks %s before an exam is created", async (_label, moduleSlug, subjectSlug) => {
    mocks.practicalScope.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await POST(request(moduleSlug, subjectSlug));
    expect(response.status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("preserves module entitlement denial", async () => {
    mocks.practicalScope.mockResolvedValue({ ok: false, reason: "forbidden" });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects mixed legacy-folder and practical-subject scopes", async () => {
    const response = await POST(new NextRequest("http://localhost/api/ospe/exam", { method: "POST", body: JSON.stringify({ folder: "RENAL", moduleSlug: "rau-203", subjectSlug: "anatomy" }) }));
    expect(response.status).toBe(400);
    expect(mocks.practicalScope).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
