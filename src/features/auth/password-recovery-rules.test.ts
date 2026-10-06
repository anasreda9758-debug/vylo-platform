import { describe, expect, it } from "vitest";

// secret() requires BETTER_AUTH_SECRET (fail-closed); provide a test value.
process.env.BETTER_AUTH_SECRET = "unit-test-secret";

import {
  PASSWORD_RESET_CODE_TTL_MS,
  PASSWORD_RESET_MAX_ATTEMPTS,
  PASSWORD_RESET_RESEND_COOLDOWN_MS,
  codesMatch,
  formatVerificationCode,
  generateVerificationCode,
  normalizeRecoveryEmail,
  secureCodeHash,
} from "./password-recovery-rules";

describe("VYLO password recovery rules", () => {
  it("normalizes email and formats six-digit codes", () => {
    expect(normalizeRecoveryEmail("  Student@Example.COM ")).toBe("student@example.com");
    expect(formatVerificationCode(482731)).toBe("482731");
    expect(formatVerificationCode(42)).toBe("000042");
  });

  it("generates cryptographically random six-digit codes", () => {
    const code = generateVerificationCode();
    expect(code).toBeGreaterThanOrEqual(0);
    expect(code).toBeLessThan(1_000_000);
    expect(formatVerificationCode(code)).toMatch(/^\d{6}$/);
  });

  it("uses a ten-minute expiry, five attempts, and sixty-second resend cooldown", () => {
    expect(PASSWORD_RESET_CODE_TTL_MS).toBe(600_000);
    expect(PASSWORD_RESET_MAX_ATTEMPTS).toBe(5);
    expect(PASSWORD_RESET_RESEND_COOLDOWN_MS).toBe(60_000);
  });

  it("matches only the hashed code", () => {
    const hash = secureCodeHash("482731");
    expect(codesMatch(hash, "482731")).toBe(true);
    expect(codesMatch(hash, "482732")).toBe(false);
  });
});
