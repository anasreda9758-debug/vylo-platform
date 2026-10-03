/**
 * VYLO money handling.
 *
 * Canonical stored/computed money unit is the integer piaster (EGP cent):
 * 1 EGP = 100 piasters. Never use floating point for stored amounts or
 * arithmetic; convert to EGP only for display.
 */

export const EGP_TO_CENTS = 100;

export function egpToCents(egp: number): number {
  if (!Number.isFinite(egp)) throw new Error("INVALID_EGP_AMOUNT");
  return Math.round(egp * EGP_TO_CENTS);
}

export function centsToEgp(cents: number): number {
  assertCents(cents);
  return cents / EGP_TO_CENTS;
}

export function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function assertCents(value: unknown): asserts value is number {
  if (!isCents(value)) throw new Error("INVALID_CENTS_AMOUNT");
}

/**
 * Read a stored amount that may be either in the legacy whole-EGP column or the
 * new integer-piaster column. `cents` wins when present; otherwise the legacy
 * EGP value is converted. This is the compatibility seam that lets the app run
 * before the additive `*_cents` migration has been applied.
 */
export function resolveStoredCents(cents: number | null | undefined, legacyEgp: number): number {
  if (cents !== null && cents !== undefined) {
    assertCents(cents);
    return cents;
  }
  return egpToCents(legacyEgp);
}

export function formatEgp(cents: number, locale: "en" | "ar" = "en"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsToEgp(cents));
}

export function formatCents(cents: number): string {
  return `${cents / EGP_TO_CENTS} EGP`;
}
