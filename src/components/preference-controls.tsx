"use client";

import { Languages, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useLocale } from "@/components/locale-provider";

const THEME_CHANGE_EVENT = "horus-theme-change";

function subscribeToTheme(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

function getThemeSnapshot() {
  return document.documentElement.classList.contains("dark");
}

function getServerThemeSnapshot() {
  return false;
}

function savePreference(key: "horus_locale" | "horus_theme", value: string) {
  document.cookie = `${key}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export function PreferenceControls({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLocale();
  const dark = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);

  function toggleLocale() {
    const next = locale === "en" ? "ar" : "en";
    savePreference("horus_locale", next);
    window.location.reload();
  }

  function toggleTheme() {
    const next = dark ? "light" : "dark";
    savePreference("horus_theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <div className={`flex items-center ${compact ? "gap-1" : "gap-2"}`} aria-label={t("Display preferences", "تفضيلات العرض")}>
      <button
        type="button"
        onClick={toggleLocale}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        title={t("Switch interface language", "تبديل لغة الواجهة")}
      >
        <Languages className="h-3.5 w-3.5" aria-hidden="true" />
        {locale === "en" ? "AR" : "EN"}
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        title={dark ? t("Use light mode", "استخدام الوضع الفاتح") : t("Use dark mode", "استخدام الوضع الداكن")}
        aria-label={dark ? t("Use light mode", "استخدام الوضع الفاتح") : t("Use dark mode", "استخدام الوضع الداكن")}
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
}
