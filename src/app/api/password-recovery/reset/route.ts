import { NextResponse } from "next/server";
import { completePasswordReset } from "@/features/auth/password-recovery";

export async function POST(request: Request) {
  let resetToken = "";
  let newPassword = "";
  let confirmPassword = "";
  try {
    ({ resetToken, newPassword, confirmPassword } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json({ error: "Password must be between 8 and 128 characters" }, { status: 400 });
  }
  const result = await completePasswordReset(resetToken, newPassword);
  if (!result.ok) return NextResponse.json({ error: "Reset authorization expired or invalid" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
