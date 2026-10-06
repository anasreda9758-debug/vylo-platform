import { NextResponse } from "next/server";
import { resendPasswordResetChallenge } from "@/features/auth/password-recovery";

export async function POST(request: Request) {
  let challengeId = "";
  try {
    ({ challengeId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const result = await resendPasswordResetChallenge(challengeId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === "COOLDOWN" ? "Please wait before requesting another code." : "Unable to resend code." },
      { status: result.reason === "COOLDOWN" ? 429 : 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
