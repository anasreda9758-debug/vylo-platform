import { describe, expect, it } from "vitest";
import { ActivationError, decideActivation } from "./activation";

const now = new Date("2026-09-21T00:00:00.000Z");
const termEnd = new Date("2027-01-15T00:00:00.000Z");

describe("subscription activation decisions", () => {
  it("creates a subscription when the user has none for the plan", () => {
    const decision = decideActivation({ periodEndsAt: termEnd, now, activeExpiries: [] });
    expect(decision).toEqual({ outcome: "created", expiresAt: termEnd });
  });

  it("does not duplicate an activation that already covers the period", () => {
    const later = new Date("2027-03-01T00:00:00.000Z");
    const decision = decideActivation({ periodEndsAt: termEnd, now, activeExpiries: [later] });
    expect(decision.outcome).toBe("already-active");
    expect(decision.expiresAt).toEqual(later);
  });

  it("extends access when the existing subscription ends before the period", () => {
    const earlier = new Date("2026-11-01T00:00:00.000Z");
    const decision = decideActivation({ periodEndsAt: termEnd, now, activeExpiries: [earlier] });
    expect(decision.outcome).toBe("extended");
    expect(decision.expiresAt).toEqual(termEnd);
  });

  it("uses the latest expiry and never shortens access", () => {
    const earlier = new Date("2026-11-01T00:00:00.000Z");
    const later = new Date("2027-05-01T00:00:00.000Z");
    const decision = decideActivation({
      periodEndsAt: termEnd,
      now,
      activeExpiries: [earlier, later],
    });
    expect(decision.outcome).toBe("already-active");
    expect(decision.expiresAt).toEqual(later);
  });

  it("rejects activating a period that has already ended", () => {
    const ended = new Date("2026-09-01T00:00:00.000Z");
    expect(() =>
      decideActivation({ periodEndsAt: ended, now, activeExpiries: [] }),
    ).toThrow(ActivationError);
  });
});
