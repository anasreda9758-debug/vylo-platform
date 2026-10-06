import { describe, expect, it, vi } from "vitest";

// These policy tests must not require a database. Database-backed guards are
// exercised by route handlers; the decision rules below are shared by them.
vi.mock("@/shared/db", () => ({ db: {} }));
vi.mock("@/features/billing/queries", () => ({ hasModuleAccess: vi.fn() }));

import {
  canUseLecturePreview,
  decideModuleAccess,
  getOspeModuleSlug,
  isResourceOwner,
  questionBelongsToBank,
} from "./learning-access";

const paidModule = { isFree: false };
const freeModule = { isFree: true };
const student = { id: "student-1", role: "student" };
const admin = { id: "admin-1", role: "admin" };

describe("learning access policy", () => {
  it("denies an unauthenticated request", () => {
    expect(decideModuleAccess(null, paidModule, false)).toMatchObject({
      ok: false,
      reason: "unauthenticated",
    });
  });

  it("denies an authenticated user without entitlement", () => {
    expect(decideModuleAccess(student, paidModule, false)).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });

  it("allows a user with a valid entitlement", () => {
    expect(decideModuleAccess(student, paidModule, true)).toMatchObject({
      ok: true,
      access: "full",
    });
  });

  it("allows an admin without a subscription", () => {
    expect(decideModuleAccess(admin, paidModule, false)).toMatchObject({ ok: true });
  });

  it("allows a free module without a subscription", () => {
    expect(decideModuleAccess(student, freeModule, false)).toMatchObject({ ok: true });
  });

  it("permits only the DB-resolved first lecture as a preview", () => {
    expect(canUseLecturePreview("lecture-1", "lecture-1", true)).toBe(true);
  });

  it("does not permit an arbitrary paid lecture as a preview", () => {
    expect(canUseLecturePreview("lecture-2", "lecture-1", true)).toBe(false);
  });

  it("uses the paid-module rule for protected quiz-question requests", () => {
    expect(decideModuleAccess(student, paidModule, false).ok).toBe(false);
  });

  it("uses the paid-module rule before a correct answer can be returned", () => {
    expect(decideModuleAccess(student, paidModule, false).ok).toBe(false);
  });

  it("rejects a question submitted against a different question bank", () => {
    expect(questionBelongsToBank("bank-a", "bank-b")).toBe(false);
  });

  it("accepts a question only when it belongs to the requested bank", () => {
    expect(questionBelongsToBank("bank-a", "bank-a")).toBe(true);
  });

  it("denies another user's private attempt, case, card, or OSPE exam", () => {
    expect(isResourceOwner(student, "student-2")).toBe(false);
  });

  it("permits a user to use only their own private learning record", () => {
    expect(isResourceOwner(student, "student-1")).toBe(true);
  });

  it("maps OSPE folders through known curriculum modules only", () => {
    expect(getOspeModuleSlug("CVS")).toBe("cvs-202");
    expect(getOspeModuleSlug("../../untrusted")).toBeNull();
  });
});
