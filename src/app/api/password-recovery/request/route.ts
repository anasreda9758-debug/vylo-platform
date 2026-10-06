import { NextResponse } from "next/server";
import { createPasswordResetChallenge, PASSWORD_RESET_MESSAGE } from "@/features/auth/password-recovery";
import { logger } from "@/shared/logger";

function requestIp(request: Request) {
  if (process.env.TRUST_PROXY !== "true") return "unknown";
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
}

export async function POST(request: Request) {
  let email = "";
  try {
    ({ email } = await request.json());
  } catch {
    // Keep the public response generic even for malformed requests.
  }
  if (typeof email !== "string" || email.trim().length === 0) {
    return NextResponse.json({ message: PASSWORD_RESET_MESSAGE });
  }
  try {
    const result = await createPasswordResetChallenge(email, requestIp(request));
    logger.info({ event: "PASSWORD_RESET_REQUESTED", limited: result.limited }, "Password reset requested");
    return NextResponse.json({ message: PASSWORD_RESET_MESSAGE, challengeId: result.challengeId });
  } catch (error) {
    logger.error({ err: error }, "Password reset request failed");
    return NextResponse.json({ message: PASSWORD_RESET_MESSAGE });
  }
}
