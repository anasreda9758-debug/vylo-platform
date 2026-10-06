"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useLocale } from "@/components/locale-provider";
import { PreferenceControls } from "@/components/preference-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "email" | "code" | "password" | "success";

const genericMessage = "If an account exists for this email, we've sent a verification code.";

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  async function post(path: string, body: object) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as { error?: string; message?: string; challengeId?: string; resetToken?: string };
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const data = await post("/api/password-recovery/request", { email });
      if (data.challengeId) {
        setChallengeId(data.challengeId);
        setStep("code");
        setResendIn(60);
        const timer = window.setInterval(() => {
          setResendIn((value) => {
            if (value <= 1) {
              window.clearInterval(timer);
              return 0;
            }
            return value - 1;
          });
        }, 1000);
      }
      setMessage(t(genericMessage, "إذا كان هناك حساب مرتبط بهذا البريد، فقد تم إرسال رمز التحقق."));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await post("/api/password-recovery/verify", { challengeId, code });
      setResetToken(data.resetToken ?? "");
      setStep("password");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Incorrect code");
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    if (resendIn > 0) return;
    setError(null);
    try {
      await post("/api/password-recovery/resend", { challengeId });
      setResendIn(60);
      setMessage(t("A new code was sent if an account exists for this email.", "تم إرسال رمز جديد إذا كان هناك حساب مرتبط بهذا البريد."));
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Unable to resend code");
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await post("/api/password-recovery/reset", { resetToken, newPassword, confirmPassword });
      setStep("success");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      <div className="absolute end-4 top-4"><PreferenceControls /></div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {step === "success"
              ? t("Password changed", "تم تغيير كلمة المرور")
              : t("Forgot password?", "نسيت كلمة المرور؟")}
          </CardTitle>
          <CardDescription>
            {step === "email" && t("Enter your email and we’ll send a verification code.", "أدخل بريدك الإلكتروني وسنرسل رمز التحقق.")}
            {step === "code" && t("Enter the 6-digit code from your email.", "أدخل الرمز المكون من 6 أرقام من بريدك الإلكتروني.")}
            {step === "password" && t("Choose a new password for your VYLO account.", "اختر كلمة مرور جديدة لحساب VYLO.")}
            {step === "success" && t("Your password was changed successfully.", "تم تغيير كلمة المرور بنجاح.")}
          </CardDescription>
        </CardHeader>
        {step === "email" && (
          <form onSubmit={requestCode}>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="recovery-email">{t("Email", "البريد الإلكتروني")}</Label>
                <Input id="recovery-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
              </div>
              {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button type="submit" className="w-full" disabled={loading}>{t("Send verification code", "إرسال رمز التحقق")}</Button>
              <Link href="/sign-in" className="text-sm underline">{t("Back to sign in", "العودة لتسجيل الدخول")}</Link>
            </CardFooter>
          </form>
        )}
        {step === "code" && (
          <form onSubmit={verifyCode}>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="recovery-code">{t("Verification code", "رمز التحقق")}</Label>
                <Input id="recovery-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required autoComplete="one-time-code" />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>{t("Verify code", "تحقق من الرمز")}</Button>
              <Button type="button" variant="link" disabled={resendIn > 0} onClick={resendCode}>
                {resendIn > 0 ? t(`Resend in ${resendIn}s`, `إعادة الإرسال خلال ${resendIn}ث`) : t("Resend code", "إعادة إرسال الرمز")}
              </Button>
            </CardFooter>
          </form>
        )}
        {step === "password" && (
          <form onSubmit={resetPassword}>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-password">{t("New password", "كلمة المرور الجديدة")}</Label>
                <Input id="new-password" type="password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required autoComplete="new-password" />
              </div>
              <p className="text-xs text-muted-foreground">{t("Use 8–128 characters.", "استخدم من 8 إلى 128 حرفًا.")}</p>
              <div className="grid gap-2">
                <Label htmlFor="confirm-password">{t("Confirm new password", "تأكيد كلمة المرور الجديدة")}</Label>
                <Input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required autoComplete="new-password" />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={loading}>{t("Set new password", "تعيين كلمة المرور الجديدة")}</Button>
            </CardFooter>
          </form>
        )}
        {step === "success" && (
          <CardFooter>
            <Link href="/sign-in" className="w-full">
              <Button className="w-full">{t("Sign in", "تسجيل الدخول")}</Button>
            </Link>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
