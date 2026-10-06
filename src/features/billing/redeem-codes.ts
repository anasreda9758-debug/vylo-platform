import { randomInt, randomUUID } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeRedeemCode(value: string) {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

export function formatRedeemCode(value: string) {
  const normalized = normalizeRedeemCode(value);
  return normalized.match(/.{1,5}/g)?.join("-") ?? normalized;
}

export function generateRedeemCode() {
  let raw = "";
  for (let i = 0; i < 25; i += 1) raw += alphabet[randomInt(alphabet.length)];
  return formatRedeemCode(raw);
}

export function rewardToDiscount(rewardType: string) {
  if (rewardType === "PERCENTAGE_DISCOUNT") return "PERCENTAGE";
  if (rewardType === "FIXED_EGP_DISCOUNT") return "FIXED_EGP";
  return null;
}

export function newRedeemCodeId() {
  return randomUUID();
}
