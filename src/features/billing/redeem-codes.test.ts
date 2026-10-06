import { describe, expect, it } from "vitest";
import { formatRedeemCode, normalizeRedeemCode } from "./redeem-codes";

describe("VYLO redeem code format", () => {
  it("normalizes lowercase, spaces, and pasted hyphens", () => {
    const raw = "7k9dm x2pt8-rq6hf n8c3w t5yl2";
    expect(normalizeRedeemCode(raw)).toBe("7K9DMX2PT8RQ6HFN8C3WT5YL2");
    expect(formatRedeemCode(raw)).toBe("7K9DM-X2PT8-RQ6HF-N8C3W-T5YL2");
  });

  it("preserves the preferred five-character groups", () => {
    expect(formatRedeemCode("1234567890123456789012345")).toBe("12345-67890-12345-67890-12345");
  });
});
