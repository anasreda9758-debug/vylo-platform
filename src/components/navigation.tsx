"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { VyloLogo, VyloMark } from "@/components/vylo-logo";
import {
  BookOpen,
  LayoutDashboard,
  FlaskConical,
  Brain,
  Stethoscope,
  CreditCard,
  Settings,
  Menu,
  X,
  GraduationCap,
  Swords,
  Trophy,
  BarChart3,
  RefreshCw,
  Search,
} from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { PreferenceControls } from "@/components/preference-controls";
import { useLocale } from "@/components/locale-provider";
import { StudentNavigation } from "./student-navigation";

const navItems = [
  { href: "/dashboard", label: { en: "Student dashboard", ar: "لوحة الطالب" }, icon: LayoutDashboard },
  { href: "/curriculum", label: { en: "Curriculum", ar: "المنهج" }, icon: BookOpen },
  { href: "/search", label: { en: "Study search", ar: "بحث دراسي" }, icon: Search },
  { href: "/flashcards", label: { en: "Flashcards", ar: "البطاقات التعليمية" }, icon: Brain },
  { href: "/cases", label: { en: "Clinical cases", ar: "الحالات السريرية" }, icon: Stethoscope },
  { href: "/ospe", label: { en: "OSPE simulator", ar: "محاكي OSPE" }, icon: FlaskConical },
  { href: "/review", label: { en: "Question review", ar: "مراجعة الأسئلة" }, icon: RefreshCw },
  { href: "/quiz/analytics", label: { en: "Quiz analytics", ar: "تحليلات الاختبارات" }, icon: BarChart3 },
  { href: "/quiz/bookmarks", label: { en: "Saved questions", ar: "الأسئلة المحفوظة" }, icon: BarChart3 },
  { href: "/quiz/history", label: { en: "Quiz history", ar: "تاريخ الاختبارات" }, icon: BarChart3 },
  { href: "/battles", label: { en: "Peer challenge", ar: "تحدي الأقران" }, icon: Swords },
  { href: "/leaderboard", label: { en: "Leaderboard", ar: "لوحة المتصدرين" }, icon: Trophy },
  { href: "/pricing", label: { en: "Plans", ar: "الأسعار والاشتراك" }, icon: CreditCard },
  { href: "/settings", label: { en: "Settings", ar: "الإعدادات" }, icon: Settings },
];

export function Navigation({
  user, isAdmin,
}: { user: { name: string; email: string }; isAdmin: boolean }) {
  const pathname = usePathname();
  return pathname.startsWith("/admin") ? <LegacyNavigation user={user} isAdmin={isAdmin} /> : <StudentNavigation user={user} isAdmin={isAdmin} />;
}

function LegacyNavigation({
  user,
  isAdmin,
}: {
  user: { name: string; email: string };
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useLocale();

  return (
    <>
      {/* The fixed sidebar needs an in-flow spacer so desktop content never sits underneath it. */}
      <div aria-hidden="true" className="hidden lg:block lg:w-72 lg:shrink-0" />
      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:start-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
        <div className="flex grow flex-col gap-y-6 overflow-y-auto border-e border-border bg-card px-6 pb-4 pt-8">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-3 text-foreground">
            <VyloMark className="h-9 w-9 text-primary" />
            <span className="text-lg font-bold tracking-tight">
              VYLO
              <span className="ms-1.5 align-middle text-[10px] font-medium text-muted-foreground">
                {t("smart learning", "منصة تعلّم ذكية")}
              </span>
            </span>
          </Link>

          {/* Nav links */}
          <nav className="flex flex-1 flex-col gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.label.en, item.label.ar)}
                </Link>
              );
            })}
            {isAdmin && (
              <Link
                href="/admin"
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  pathname === "/admin"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Settings className="h-4 w-4" />
                {t("Admin", "لوحة الإدارة")}
              </Link>
            )}
          </nav>

          {/* User card */}
          <div className="border-t border-border pt-4">
            <div className="mb-3 flex justify-between">
              <PreferenceControls />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {user.name.charAt(0)}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <SignOutButton />
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="sticky top-0 z-40 flex items-center gap-4 border-b border-border bg-card/90 px-4 py-3 backdrop-blur-sm lg:hidden">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-4 w-4" />
          </div>
          <VyloLogo compact className="text-primary" />
        </Link>
        <div className="ms-auto">
          <PreferenceControls compact />
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 start-0 z-50 w-72 overflow-y-auto bg-card px-6 pb-4 pt-8 shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute end-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
            <Link
              href="/dashboard"
              className="mb-6 flex items-center gap-3"
              onClick={() => setMobileOpen(false)}
            >
              <div className="flex items-center gap-3 text-foreground">
                <VyloMark className="h-9 w-9 text-primary" />
                <span className="text-lg font-bold tracking-tight">
                  VYLO
                  <span className="ms-1.5 align-middle text-[10px] font-medium text-muted-foreground">
                    {t("smart learning", "منصة تعلّم ذكية")}
                  </span>
                </span>
              </div>
            </Link>
            <div className="mb-4">
              <PreferenceControls />
            </div>
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {t(item.label.en, item.label.ar)}
                  </Link>
                );
              })}
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Settings className="h-4 w-4" />
                  {t("Admin", "لوحة الإدارة")}
                </Link>
              )}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
