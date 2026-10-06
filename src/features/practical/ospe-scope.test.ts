import { describe, expect, it, vi } from "vitest";
import { createPracticalOspeScopeResolver } from "./ospe";
import type { PracticalTrackResolution, ResolvedPracticalTrack } from "./model";

const track: ResolvedPracticalTrack = {
  id: "track-renal-anatomy", moduleId: "module-renal", moduleSlug: "rau-203", moduleName: "Renal & Urinary System", studyYear: 1,
  subject: "ANATOMY", subjectSlug: "anatomy", displayNameEn: "Anatomy", displayNameAr: "التشريح",
  status: "PUBLISHED", sortOrder: 0, practiceEnabled: true, ospeEnabled: true,
};
const actor = { id: "student-a" };

function resolver(result: PracticalTrackResolution, stations = 1) {
  const resolveTrack = vi.fn(async () => result);
  const countStations = vi.fn(async () => stations);
  return { resolve: createPracticalOspeScopeResolver(resolveTrack, countStations), resolveTrack, countStations };
}

describe("Practical OSPE module and subject scope", () => {
  it("allows an entitled actor only for the resolved module and subject with associated stations", async () => {
    const service = resolver({ ok: true, value: track });
    await expect(service.resolve(actor, "rau-203", "anatomy")).resolves.toEqual({ ok: true, value: track });
    expect(service.resolveTrack).toHaveBeenCalledWith(actor, "rau-203", "anatomy");
    expect(service.countStations).toHaveBeenCalledWith(track.id);
  });

  it.each([
    ["wrong module", "cvs-202", "anatomy"],
    ["wrong subject", "rau-203", "histology"],
  ])("denies %s instead of accepting changed URL parameters", async (_label, moduleSlug, subjectSlug) => {
    const service = resolver({ ok: false, reason: "not_found" });
    await expect(service.resolve(actor, moduleSlug, subjectSlug)).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(service.countStations).not.toHaveBeenCalled();
  });

  it("hides OSPE when the track is disabled or has no explicit station relationship", async () => {
    const disabled = resolver({ ok: true, value: { ...track, ospeEnabled: false } }, 2);
    await expect(disabled.resolve(actor, "rau-203", "anatomy")).resolves.toEqual({ ok: false, reason: "not_found" });
    const empty = resolver({ ok: true, value: track }, 0);
    await expect(empty.resolve(actor, "rau-203", "anatomy")).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("preserves entitlement denial from the centralized module resolver", async () => {
    const service = resolver({ ok: false, reason: "forbidden" });
    await expect(service.resolve(actor, "rau-203", "anatomy")).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(service.countStations).not.toHaveBeenCalled();
  });
});
