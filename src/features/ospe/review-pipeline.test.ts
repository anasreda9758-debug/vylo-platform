import { describe, expect, it } from "vitest";
import {
  buildOspeMappingDryRun,
  type OspePracticalTrack,
  type OspeReviewStation,
} from "./review-pipeline";

const moduleEvidence = {
  moduleId: "module-renal",
  moduleSlug: "rau-203",
  moduleName: "Renal & Urinary System (RAU-203)",
  explicit: true,
};

function station(
  answerKeyId = "key-1",
  overrides: Partial<OspeReviewStation> = {},
): OspeReviewStation {
  return {
    answerKeyId,
    stationId: answerKeyId,
    title: "Renal station",
    prompt: "Identify the indicated structure",
    moduleEvidence,
    answerKey: {
      diagnosis: "Kidney",
      identification: "Renal cortex",
      findings: null,
      differential: null,
      management: null,
    },
    rubrics: [{ criterion: "Correct identification", maxPoints: 2, order: 0 }],
    sourceReferences: [{ path: "public/ospe-pdfs/OSPE RENAL.pdf" }],
    image: { exactFileExists: true, previewPath: "../../images/RENAL/station.jpg" },
    assetStatus: "IMAGE_OK",
    imageRequired: true,
    answerAndRubricPresent: true,
    ...overrides,
  };
}

function track(overrides: Partial<OspePracticalTrack> = {}): OspePracticalTrack {
  return {
    id: "practical-track-rau-203-anatomy",
    moduleId: "module-renal",
    moduleSlug: "rau-203",
    moduleName: "Renal & Urinary System (RAU-203)",
    subject: "ANATOMY",
    subjectSlug: "anatomy",
    status: "PUBLISHED",
    ospeEnabled: false,
    ...overrides,
  };
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    answerKeyId: "key-1",
    subject: "Anatomy",
    verdict: "CONFIRM_SUBJECT",
    note: "Human reviewed",
    ...overrides,
  };
}

function plan({
  decisions = [decision()],
  stations = [station()],
  existingAnswerKeyIds = stations.map((record) => record.answerKeyId),
  practicalTracks = [track()],
}: {
  decisions?: unknown[];
  stations?: OspeReviewStation[];
  existingAnswerKeyIds?: string[];
  practicalTracks?: OspePracticalTrack[];
} = {}) {
  return buildOspeMappingDryRun({
    decisions,
    stations,
    existingAnswerKeyIds,
    practicalTracks,
    generatedAt: "2026-09-13T00:00:00.000Z",
  });
}

describe("OSPE post-review validation", () => {
  it("accepts a valid human-confirmed decision", () => {
    const result = plan();

    expect(result.summary).toMatchObject({ totalDecisions: 1, validConfirmed: 1, rejected: 0 });
    expect(result.entries[0]).toMatchObject({
      practicalTrack: { id: "practical-track-rau-203-anatomy" },
      readyForMapping: true,
    });
  });

  it("rejects an invalid subject", () => {
    const result = plan({ decisions: [decision({ subject: "Embryology" })] });

    expect(result.summary.rejected).toBe(1);
    expect(result.rejected[0].issues.map((issue) => issue.code)).toContain("INVALID_SUBJECT");
  });

  it("rejects an invalid verdict", () => {
    const result = plan({ decisions: [decision({ verdict: "APPROVE" })] });

    expect(result.summary.rejected).toBe(1);
    expect(result.rejected[0].issues.map((issue) => issue.code)).toContain("INVALID_VERDICT");
  });

  it("rejects every occurrence of a duplicate answerKeyId decision", () => {
    const result = plan({ decisions: [decision(), decision({ note: "Second copy" })] });

    expect(result.summary.rejected).toBe(2);
    expect(result.rejected.every((item) => item.issues.some((issue) => issue.code === "DUPLICATE_ANSWER_KEY_ID"))).toBe(true);
  });

  it("rejects an answerKeyId absent from the reviewed inventory", () => {
    const result = plan({ decisions: [decision({ answerKeyId: "does-not-exist" })] });

    expect(result.rejected[0].issues.map((issue) => issue.code)).toContain("UNKNOWN_ANSWER_KEY_ID");
  });

  it("rejects a reviewed station that no longer exists in the database", () => {
    const result = plan({ existingAnswerKeyIds: [] });

    expect(result.rejected[0].issues.map((issue) => issue.code)).toContain("STATION_NO_LONGER_EXISTS");
  });

  it("rejects conflicting decisions inside an exact-duplicate group", () => {
    const duplicate = station("key-2");
    const result = plan({
      stations: [station(), duplicate],
      existingAnswerKeyIds: ["key-1", "key-2"],
      decisions: [
        decision(),
        decision({ answerKeyId: "key-2", subject: "Histology" }),
      ],
    });

    expect(result.summary.rejected).toBe(2);
    expect(result.rejected.every((item) => item.issues.some((issue) => issue.code === "CONFLICTING_EXACT_DUPLICATE_DECISIONS"))).toBe(true);
  });

  it("rejects a track whose module identity crosses the station module boundary", () => {
    const result = plan({ practicalTracks: [track({ moduleId: "module-cvs" })] });

    expect(result.rejected[0].issues.map((issue) => issue.code)).toContain("MODULE_TRACK_MISMATCH");
  });

  it("rejects a track whose stored subject fields disagree", () => {
    const result = plan({ practicalTracks: [track({ subjectSlug: "histology" })] });

    expect(result.rejected[0].issues.map((issue) => issue.code)).toContain("SUBJECT_TRACK_MISMATCH");
  });

  it("classifies a confirmed station with a missing required image as BLOCKED_ASSET", () => {
    const missingImageStation = station("key-1", {
      image: { exactFileExists: false, previewPath: null },
      assetStatus: "IMAGE_MISSING",
      imageRequired: true,
    });
    const result = plan({ stations: [missingImageStation] });

    expect(result.entries[0]).toMatchObject({
      readiness: "BLOCKED_ASSET",
      readyForMapping: true,
      readyForOspe: false,
    });
  });

  it("classifies a valid confirmed station with an image and rubric as READY_FOR_OSPE", () => {
    const result = plan();

    expect(result.entries[0]).toMatchObject({
      assetStatus: "IMAGE_OK",
      readiness: "READY_FOR_OSPE",
      readyForMapping: true,
      readyForOspe: true,
    });
  });

  it("reports MISSING_TRACK without inventing a practical track", () => {
    const result = plan({ practicalTracks: [] });

    expect(result.entries[0]).toMatchObject({
      practicalTrack: null,
      readiness: "MISSING_TRACK",
      readyForMapping: false,
      readyForOspe: false,
    });
    expect(result.summary.missingTrack).toBe(1);
  });

  it("does not allow Unknown to be confirmed", () => {
    const result = plan({ decisions: [decision({ subject: "Unknown" })] });

    expect(result.rejected[0].issues.map((issue) => issue.code)).toContain("UNKNOWN_SUBJECT_CANNOT_BE_CONFIRMED");
  });
});
