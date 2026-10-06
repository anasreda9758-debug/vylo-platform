"use client";

import { useState, type FormEvent } from "react";
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

export default function SignUpPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await authClient.signUp.email({ name, email, password });
    if (res.error) {
      setError(res.error.message ?? t("Could not create the account.", "تعذر إنشاء الحساب"));
      setLoading(false);
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}&sent=1`);
    router.refresh();
  }

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      <div className="absolute end-4 top-4"><PreferenceControls /></div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("Create an account", "إنشاء حساب جديد")}</CardTitle>
          <CardDescription>{t("Sign up to start your learning journey", "سجّل للبدء في رحلة التعلم")}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t("Name", "الاسم")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
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
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("Creating account…", "جارٍ الإنشاء...") : t("Create account", "إنشاء الحساب")}
            </Button>
            <p className="text-sm text-muted-foreground">
              {t("Already have an account?", "لديك حساب بالفعل؟")}{" "}
              <Link href="/sign-in" className="underline">
                {t("Sign in", "سجّل الدخول")}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
