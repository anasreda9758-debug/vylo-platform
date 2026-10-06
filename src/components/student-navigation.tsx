"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { PreferenceControls } from "./preference-controls";
import { SignOutButton } from "./sign-out-button";
import { useLocale } from "./locale-provider";

export const primaryStudentLinks = [
  { href: "/dashboard", en: "Home", ar: "الرئيسية" },
  { href: "/curriculum", en: "Modules", ar: "الموديولات" },
  { href: "/dashboard#weekly-plan", en: "Study Plan", ar: "خطة الدراسة" },
  { href: "/curriculum?tool=quiz", en: "Question Bank", ar: "بنك الأسئلة" },
  { href: "/flashcards", en: "Flashcards", ar: "البطاقات" },
  { href: "/curriculum?tool=tutor", en: "AI Tutor", ar: "المعلم الذكي" },
];
const moreLinks = [
  { href: "/search", en: "Search", ar: "بحث" },
  { href: "/review", en: "Question review", ar: "مراجعة الأسئلة" },
  { href: "/quiz/bookmarks", en: "Saved questions", ar: "الأسئلة المحفوظة" },
  { href: "/quiz/history", en: "Quiz history", ar: "سجل الاختبارات" },
  { href: "/quiz/analytics", en: "Quiz analytics", ar: "تحليلات الاختبارات" },
  { href: "/cases", en: "Clinical cases", ar: "الحالات السريرية" },
  { href: "/ospe", en: "Practical & OSPE", ar: "العملي وOSPE" },
  { href: "/battles", en: "Challenges", ar: "التحديات" },
  { href: "/leaderboard", en: "Leaderboard", ar: "المتصدرون" },
];

export function StudentNavigation({
  user,
  isAdmin,
}: {
  user: { name: string; email: string };
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const main = document.querySelector("main");
    if (main && !main.id) main.id = "student-main";
  }, [pathname]);
  useEffect(() => {
    if (open) drawer.current?.showModal();
    else if (drawer.current?.open) drawer.current.close();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const active = (href: string) => {
    if (href.includes("#")) return false;
    if (href.includes("?"))
      return (
        pathname === "/curriculum" && params.get("tool") === href.split("=")[1]
      );
    if (href === "/curriculum" && params.has("tool")) return false;
    return pathname === href || pathname.startsWith(href + "/");
  };
  const links = (items: typeof primaryStudentLinks) =>
    items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => {
          close();
          if (item.href.includes("#") && pathname === "/dashboard") {
            const plan = document.getElementById("weekly-plan");
            if (plan instanceof HTMLDetailsElement) plan.open = true;
          }
        }}
        aria-current={active(item.href) ? "page" : undefined}
        className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring ${active(item.href) ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
      >
        {t(item.en, item.ar)}
      </Link>
    ));
  const menu = (
    <>
      <nav
        aria-label={t("Primary navigation", "التنقل الأساسي")}
        className="space-y-1"
      >
        {links(primaryStudentLinks)}
      </nav>
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
          {t("More tools", "أدوات أخرى")}
        </summary>
        <nav aria-label={t("More tools", "أدوات أخرى")} className="space-y-1">
          {links(moreLinks)}
        </nav>
      </details>
      <div className="mt-auto space-y-3 border-t pt-4">
        <Link
          href="/settings"
          onClick={close}
          className="block min-h-11 rounded-lg px-3 py-2 hover:bg-muted"
        >
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t("Profile & settings", "الملف والإعدادات")}
          </p>
        </Link>
        <Link
          href="/pricing"
          onClick={close}
          className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          {t("Subscriptions", "الاشتراكات")}
        </Link>
        {isAdmin && (
          <Link
            href="/admin"
            className="block px-3 py-2 text-sm text-muted-foreground"
          >
            {t("Admin", "الإدارة")}
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PreferenceControls compact />
          <SignOutButton />
        </div>
      </div>
    </>
  );
  return (
    <>
      <a
        href="#student-main"
        className="sr-only z-[100] focus:fixed focus:start-4 focus:top-4 focus:not-sr-only focus:rounded-lg focus:bg-primary focus:p-3 focus:text-primary-foreground"
      >
        {t("Skip to content", "انتقل للمحتوى")}
      </a>
      <div aria-hidden="true" className="hidden lg:block lg:w-56 lg:shrink-0" />
      <aside
        aria-label={t("Student sidebar", "قائمة الطالب")}
        className="fixed inset-y-0 start-0 z-40 hidden w-56 flex-col gap-5 overflow-y-auto border-e bg-card px-3 py-5 lg:flex"
      >
        <Link
          href="/dashboard"
          className="px-3 py-2 text-lg font-semibold tracking-tight"
        >
          VYLO
        </Link>
        {menu}
      </aside>
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b bg-card px-4 lg:hidden">
        <Link
          href="/dashboard"
          className="text-lg font-semibold tracking-tight"
        >
          VYLO
        </Link>
        <button
          ref={trigger}
          onClick={() => setOpen(true)}
          aria-label={t("Open navigation", "افتح القائمة")}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>
      <dialog
        ref={drawer}
        onCancel={close}
        onClose={() => {
          if (open) close();
        }}
        aria-label={t("Student navigation", "قائمة الطالب")}
        className="fixed inset-y-0 start-0 end-auto m-0 h-dvh max-h-none w-[min(320px,90vw)] max-w-none border-e bg-card p-4 text-foreground backdrop:bg-black/30 lg:hidden"
      >
        <div className="flex h-full flex-col gap-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">VYLO</span>
            <button
              onClick={close}
              aria-label={t("Close navigation", "أغلق القائمة")}
              className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {menu}
        </div>
      </dialog>
    </>
  );
}
