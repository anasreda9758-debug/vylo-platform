import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PASSWORD_RESET_CODE_TTL_MS = 10 * 60 * 1000;
export const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) {
    throw new Error("BETTER_AUTH_SECRET is required for password recovery");
  }
  return value;
}

export function normalizeRecoveryEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashRecoveryValue(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function generateVerificationCode() {
  return randomBytes(4).readUInt32BE(0) % 1_000_000;
}

export function formatVerificationCode(value: number) {
  return String(value).padStart(6, "0");
}

export function secureCodeHash(code: string) {
  return createHash("sha256").update(`${secret()}:${code}`).digest("hex");
}

export function codesMatch(expectedHash: string, code: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(secureCodeHash(code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
