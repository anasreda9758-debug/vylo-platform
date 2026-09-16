"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useLocale } from "@/components/locale-provider";
import { PreferenceControls } from "@/components/preference-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const genericEmail = (email: string) => {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 1)}***@${domain}`;
};

export default function VerifyEmailPage() {
  const { t } = useLocale();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(params.get("sent") === "1");
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(params.get("sent") === "1" ? 60 : 0);
  const [error, setError] = useState<string | null>(null);

  function startCountdown() {
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

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), type: "email-verification" }),
      });
      if (!response.ok) throw new Error("Unable to send verification code");
      setSent(true);
      startCountdown();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send verification code");
    } finally {
      setLoading(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/email-otp/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Incorrect verification code");
      setVerified(true);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Incorrect verification code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      <div className="absolute end-4 top-4"><PreferenceControls /></div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{verified ? t("Email verified", "تم تأكيد البريد الإلكتروني") : t("Verify your email", "تحقق من بريدك الإلكتروني")}</CardTitle>
          <CardDescription>
            {verified
              ? t("Your email is verified. Sign in to continue.", "تم تأكيد بريدك الإلكتروني. سجّل الدخول للمتابعة.")
              : t("Enter the verification code sent to your email.", "أدخل رمز التحقق المرسل إلى بريدك الإلكتروني.")}
          </CardDescription>
        </CardHeader>
        {verified ? (
          <CardFooter>
            <Link href="/sign-in" className="w-full"><Button className="w-full">{t("Sign in", "تسجيل الدخول")}</Button></Link>
          </CardFooter>
        ) : (
          <form onSubmit={sent ? verify : sendCode}>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="verification-email">{t("Email", "البريد الإلكتروني")}</Label>
                <Input id="verification-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
              </div>
              {sent ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t(`We sent a verification code to ${genericEmail(email)}.`, `أرسلنا رمز التحقق إلى ${genericEmail(email)}.`)}
                  </p>
                  <div className="grid gap-2">
                    <Label htmlFor="verification-code">{t("Verification code", "رمز التحقق")}</Label>
                    <Input id="verification-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} required autoComplete="one-time-code" />
                  </div>
                </>
              ) : null}
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button type="submit" className="w-full" disabled={loading || (sent && otp.length !== 6)}>
                {sent ? t("Confirm email", "تأكيد البريد الإلكتروني") : t("Send verification code", "إرسال رمز التحقق")}
              </Button>
              {sent ? (
                <Button type="button" variant="link" disabled={resendIn > 0 || loading} onClick={() => void sendCode()}>
                  {resendIn > 0 ? t(`Resend in ${resendIn}s`, `إعادة الإرسال خلال ${resendIn}ث`) : t("Resend code", "إعادة إرسال الرمز")}
                </Button>
              ) : null}
              <Link href="/sign-in" className="text-sm underline">{t("Back to sign in", "العودة لتسجيل الدخول")}</Link>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
