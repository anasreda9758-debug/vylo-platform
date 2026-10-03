import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/shared/db", () => ({
  db: {
    query: { curriculumModule: { findMany: mocks.findMany } },
    select: (arg: unknown) => {
      mocks.select(arg);
      return { from: mocks.from };
    },
  },
}));

import { getCurriculum, getModuleBySlug } from "./queries";

function moduleRow(slug: string) {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    description: null,
    subjectId: null,
    order: 0,
    isFree: false,
    studyYear: 1,
    term: 1,
    academicPeriodId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lectures: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockResolvedValue([]);
});

describe("getCurriculum (Stage B visibility)", () => {
  it("omits the excluded requirement modules from student lists", async () => {
    mocks.findMany.mockResolvedValue([
      moduleRow("ahe-101"),
      moduleRow("mt-104"),
      moduleRow("en-105"),
      moduleRow("uni-205"),
    ]);
    const result = await getCurriculum("user-1", 1);
    expect(result.map((m) => m.slug)).toEqual(["ahe-101"]);
  });

  it("keeps unverified medical/elective records visible", async () => {
    mocks.findMany.mockResolvedValue([
      moduleRow("e-1"),
      moduleRow("gp-10"),
      moduleRow("uni-205"),
    ]);
    const result = await getCurriculum("user-1");
    expect(result.map((m) => m.slug)).toEqual(["e-1", "gp-10"]);
  });

  it("does not resolve excluded modules for student detail pages", async () => {
    mocks.findMany.mockResolvedValue([moduleRow("mt-104"), moduleRow("ahe-101")]);
    expect(await getModuleBySlug("user-1", "mt-104")).toBeNull();
    expect((await getModuleBySlug("user-1", "ahe-101"))?.slug).toBe("ahe-101");
  });
});
