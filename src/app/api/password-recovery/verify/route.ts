import { NextResponse } from "next/server";
import { verifyPasswordResetCode } from "@/features/auth/password-recovery";
import { logger } from "@/shared/logger";

export async function POST(request: Request) {
  let challengeId = "";
  let code = "";
  try {
    ({ challengeId, code } = await request.json());
  } catch {
    return NextResponse.json({ error: "Incorrect code" }, { status: 400 });
  }
  const result = await verifyPasswordResetCode(challengeId, code);
  if (!result.ok) {
    const message = result.reason === "EXPIRED"
      ? "Code expired"
      : result.reason === "TOO_MANY_ATTEMPTS"
        ? "Too many attempts"
        : "Incorrect code";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  logger.info({ event: "PASSWORD_RESET_VERIFIED" }, "Password reset code verified");
  return NextResponse.json({ resetToken: result.resetToken });
}
