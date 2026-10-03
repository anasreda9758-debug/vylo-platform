import { describe, expect, it } from "vitest";
import {
  isHiddenFromStudentCurriculum,
  REQUIREMENT_MODULE_SLUGS,
} from "./curriculum-copy";

describe("student-facing curriculum visibility (Stage B)", () => {
  it("contains exactly the three owner-approved exclusions", () => {
    expect([...REQUIREMENT_MODULE_SLUGS].sort()).toEqual([
      "en-105",
      "mt-104",
      "uni-205",
    ]);
  });

  it("hides the excluded university/faculty requirement modules", () => {
    for (const slug of ["mt-104", "en-105", "uni-205"]) {
      expect(isHiddenFromStudentCurriculum(slug)).toBe(true);
    }
  });

  it("keeps medical modules visible, including the unverified elective/GP records", () => {
    for (const slug of [
      "ahe-101",
      "ppg-102",
      "pmb-103",
      "rs-201",
      "cvs-202",
      "rau-203",
      "ibl-204",
      "e-1",
      "e-2",
      "e-3",
      "e-4",
      "gp-10",
    ]) {
      expect(isHiddenFromStudentCurriculum(slug)).toBe(false);
    }
  });
});
