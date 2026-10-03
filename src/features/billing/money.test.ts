import { describe, expect, it } from "vitest";
import {
  EGP_TO_CENTS,
  centsToEgp,
  egpToCents,
  formatCents,
  isCents,
  resolveStoredCents,
} from "./money";

describe("VYLO money (integer piasters)", () => {
  it("converts EGP to piasters without floating point drift", () => {
    expect(EGP_TO_CENTS).toBe(100);
    expect(egpToCents(149)).toBe(14900);
    expect(egpToCents(357.6)).toBe(35760);
    expect(egpToCents(0.1 + 0.2)).toBe(30);
    expect(egpToCents(50)).toBe(5000);
  });

  it("converts piasters back to EGP", () => {
    expect(centsToEgp(14900)).toBe(149);
    expect(centsToEgp(35760)).toBe(357.6);
    expect(formatCents(14900)).toBe("149 EGP");
  });

  it("rejects non-integer piaster amounts", () => {
    expect(isCents(14900)).toBe(true);
    expect(isCents(149.5)).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
    expect(() => centsToEgp(1.5)).toThrow("INVALID_CENTS_AMOUNT");
    expect(() => egpToCents(Number.NaN)).toThrow("INVALID_EGP_AMOUNT");
  });

  it("prefers stored cents and falls back to legacy EGP", () => {
    expect(resolveStoredCents(35760, 449)).toBe(35760);
    expect(resolveStoredCents(null, 149)).toBe(14900);
    expect(resolveStoredCents(undefined, 50)).toBe(5000);
    expect(() => resolveStoredCents(1.5, 149)).toThrow("INVALID_CENTS_AMOUNT");
  });
});
