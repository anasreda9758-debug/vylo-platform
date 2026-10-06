"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/shared/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PreferenceControls } from "@/components/preference-controls";
import { useLocale } from "@/components/locale-provider";

export default function SignInPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void authClient.getSession().then(({ data }) => {
      if (!active || !data?.user) return;
      router.replace("/dashboard");
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await authClient.signIn.email({ email, password });
    if (res.error) {
      setError(res.error.message ?? t("Incorrect sign-in details.", "بيانات الدخول غير صحيحة"));
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      <div className="absolute end-4 top-4"><PreferenceControls /></div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("Sign in", "تسجيل الدخول")}</CardTitle>
          <CardDescription>{t("Welcome back to VYLO", "أهلاً بعودتك إلى VYLO")}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">{t("Email", "البريد الإلكتروني")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t("Password", "كلمة المرور")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("Signing in…", "جارٍ الدخول...") : t("Sign in", "تسجيل الدخول")}
            </Button>
            <Link href="/forgot-password" className="text-sm text-muted-foreground underline">
              {t("Forgot password?", "نسيت كلمة المرور؟")}
            </Link>
            {error?.toLowerCase().includes("email") ? (
              <Link href={`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`} className="text-sm text-muted-foreground underline">
                {t("Verify your email", "تحقق من بريدك الإلكتروني")}
              </Link>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {t("Don't have an account?", "ليس لديك حساب؟")}{" "}
              <Link href="/sign-up" className="underline">
                {t("Create one", "أنشئ حسابًا")}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
