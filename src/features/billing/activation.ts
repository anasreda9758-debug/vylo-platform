/**
 * Pure subscription-activation decisions.
 *
 * Kept free of database access so the rules (idempotency, extension, never
 * shortening access) can be unit-tested directly. `queries.activateSubscription`
 * loads the inputs and applies the decision.
 */

export type ActivationOutcome = "created" | "extended" | "already-active";

export type ActivationDecision = {
  outcome: ActivationOutcome;
  /** The resulting expiry to persist. Never earlier than any existing expiry. */
  expiresAt: Date;
};

export class ActivationError extends Error {
  constructor(public readonly code: "PERIOD_NOT_FOUND" | "PERIOD_ENDED" | "PLAN_NOT_ACTIVATABLE" | "PLAN_SCOPE_NOT_SELLABLE") {
    super(code);
    this.name = "ActivationError";
  }
}

export type DecideActivationInput = {
  /** End of the academic period the plan grants access to. */
  periodEndsAt: Date;
  /** Current time; injectable for tests. */
  now: Date;
  /** Expiries of the user's existing active (or grace) subscriptions for this plan. */
  activeExpiries: Date[];
};

/**
 * Decide what activating a plan should do for a user.
 *
 * - No existing subscription for the plan → `created`.
 * - Existing subscription already covers the period → `already-active` (no
 *   duplicate row, no shortening).
 * - Existing subscription ends before the period → `extended` to the later
 *   period end (renewal extends access; it never reduces it).
 *
 * Throws `ActivationError("PERIOD_ENDED")` when the period has already ended.
 */
export function decideActivation(input: DecideActivationInput): ActivationDecision {
  const { periodEndsAt, now, activeExpiries } = input;
  if (periodEndsAt.getTime() <= now.getTime()) {
    throw new ActivationError("PERIOD_ENDED");
  }

  if (activeExpiries.length === 0) {
    return { outcome: "created", expiresAt: periodEndsAt };
  }

  let latest = activeExpiries[0];
  for (const expiry of activeExpiries) {
    if (expiry.getTime() > latest.getTime()) latest = expiry;
  }

  if (latest.getTime() >= periodEndsAt.getTime()) {
    return { outcome: "already-active", expiresAt: latest };
  }

  return { outcome: "extended", expiresAt: periodEndsAt };
}

export function isActivationFailure(
  value: unknown,
): value is { activationFailed: true; code: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { activationFailed?: unknown }).activationFailed === true
  );
}
