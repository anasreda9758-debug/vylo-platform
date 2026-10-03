"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";
import { saveOspeAnswer } from "@/features/ospe/integrity";

type Station = {
  id: string;
  order: number;
  folder: string;
  fileName: string;
  studentAnswer: string | null;
  score?: number | null;
  timeSpentSec: number | null;
};

type ExamData = {
  examId: string;
  stationCount: number;
  totalTimeLimitSec: number;
  timePerStationSec: number;
  status: string;
  stations: Station[];
};

type ExamResult = {
  totalScore: number;
  maxPossibleScore: number;
  percentage: number;
  stations: { id: string; score: number }[];
};

export function ExamMode({ folder, moduleSlug, subjectSlug, availableStationCount = 0 }: { folder?: string; moduleSlug?: string; subjectSlug?: string; availableStationCount?: number }) {
  const { t } = useLocale();
  const router = useRouter();
  const [exam, setExam] = useState<ExamData | null>(null);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [timeLeft, setTimeLeft] = useState(0);
  const [stationTimeLeft, setStationTimeLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const stationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stationStartRef = useRef<number>(0);
  const savingRef = useRef(false);
  const totalDeadlineRef = useRef(0);

  const handleFinish = useCallback(async () => {
    if (!exam) return;
    if (timerRef.current) clearInterval(timerRef.current);
    if (stationTimerRef.current) clearInterval(stationTimerRef.current);

    try {
      const res = await fetch(`/api/ospe/exam/${exam.examId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish" }),
      });
      if (!res.ok) throw new Error("Could not finish the exam. Please retry.");
      if (res.ok) {
        const data = await res.json();
        setResult(data);
        setExam((prev) => (prev ? { ...prev, status: "completed", stations: prev.stations.map((s) => ({ ...s, score: data.stations?.find((r: { id: string; score: number }) => r.id === s.id)?.score ?? 0 })) } : null));
      }
    } catch {
      setError(t("Could not finish the exam.", "تعذر إنهاء الامتحان"));
    }
  }, [exam]);

  const handleSubmitAnswer = useCallback(async (finishAfter = false) => {
    if (!exam || savingRef.current) return;
    const station = exam.stations[currentIdx];
    if (!station) return;

    const timeSpent = Math.round((Date.now() - stationStartRef.current) / 1000);
    savingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      await saveOspeAnswer(fetch, `/api/ospe/exam/${exam.examId}`, {
          stationId: station.id,
          answer,
          timeSpentSec: timeSpent,
      });
      if (!finishAfter && currentIdx < exam.stations.length - 1) {
        setAnswer("");
        setCurrentIdx((i) => i + 1);
        setStationTimeLeft(exam.timePerStationSec);
        stationStartRef.current = Date.now();
      } else {
        // Keep the typed answer if finalization fails so a retry cannot erase it.
        await handleFinish();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Answer was not saved. Please retry this station.");
    } finally {
      savingRef.current = false;
      setSubmitting(false);
    }
  }, [exam, currentIdx, answer, handleFinish]);

  // Global timer
  useEffect(() => {
    if (!exam || exam.status !== "in_progress") return;

    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((totalDeadlineRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0 && !error) void handleSubmitAnswer(true);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [exam, error, handleSubmitAnswer]);

  // Station timer
  useEffect(() => {
    if (!exam || exam.status !== "in_progress") return;

    stationTimerRef.current = setInterval(() => {
      const remaining = Math.max(0, exam.timePerStationSec - Math.floor((Date.now() - stationStartRef.current) / 1000));
      setStationTimeLeft(remaining);
      if (remaining === 0 && !error) void handleSubmitAnswer(Date.now() >= totalDeadlineRef.current);
    }, 1000);

    return () => {
      if (stationTimerRef.current) clearInterval(stationTimerRef.current);
    };
  }, [currentIdx, exam, error, handleSubmitAnswer]);

  const startExam = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ospe/exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: folder || undefined,
          moduleSlug,
          subjectSlug,
          stationCount: 10,
          timePerStationSec: 60,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t("Could not create the exam.", "فشل إنشاء الامتحان"));
        return;
      }
      const data = await res.json();
      setExam(data);
      setTimeLeft(data.totalTimeLimitSec);
      setStationTimeLeft(data.timePerStationSec);
      stationStartRef.current = Date.now();
      totalDeadlineRef.current = Date.now() + data.totalTimeLimitSec * 1000;
    } catch {
      setError(t("Could not connect to the server.", "تعذر الاتصال بالخادم"));
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // No exam yet — show start screen
  if (!exam) {
    if (availableStationCount === 0) {
      return (
        <div className="rounded-xl bg-card p-10 text-center ring-1 ring-foreground/10">
          <h2 className="mb-2 text-xl font-semibold">{t("OSPE exam is not available yet", "امتحان OSPE غير متاح حاليًا")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("No approved stations are available for your current access.", "لا توجد محطات معتمدة متاحة لصلاحية حسابك الحالية.")}
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
        <h2 className="mb-2 text-2xl font-bold">{t("Exam mode", "وضع الامتحان")}</h2>
        <p className="mb-6 text-muted-foreground">
          {t("Focused exam mode — answers cannot be changed, with a time limit for each station.", "امتحان صارم — لا يمكن التراجع عن الإجابة، والوقت محدد لكل محطة.")}
        </p>
        <div className="mb-6 grid grid-cols-3 gap-4 text-sm">
          <div className="rounded-lg bg-muted p-3">
            <div className="text-lg font-bold">10</div>
            <div className="text-muted-foreground">{t("stations", "محطات")}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-lg font-bold">{t("60 sec", "60 ثانية")}</div>
            <div className="text-muted-foreground">{t("per station", "لكل محطة")}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-lg font-bold">{t("10 min", "10 دقائق")}</div>
            <div className="text-muted-foreground">{t("total", "المجموع")}</div>
          </div>
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-600">{error}</div>
        )}
        <Button onClick={startExam} disabled={loading} size="lg">
          {loading ? t("Creating exam…", "جارٍ إنشاء الامتحان…") : t("Start exam", "ابدأ الامتحان")}
        </Button>
      </div>
    );
  }

  // Exam completed — show results
  if (exam.status === "completed" && result) {
    return (
      <div className="rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
        <h2 className="mb-4 text-2xl font-bold">{t("Exam result", "نتيجة الامتحان")}</h2>
        <div className="mb-6 flex items-center justify-center gap-8">
          <div>
            <div className="text-5xl font-bold text-primary">{result.percentage}%</div>
            <div className="text-muted-foreground">{t("Percentage", "النسبة")}</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold">{result.totalScore} / {result.maxPossibleScore}</div>
            <div className="text-muted-foreground">{t("Points", "النقاط")}</div>
          </div>
        </div>
        <div className="mb-6 grid grid-cols-10 gap-2">
          {exam.stations.map((s, i) => (
            <div
              key={s.id}
              className={`rounded-lg p-2 text-center text-xs font-medium ${
                (s.score ?? 0) > 0
                  ? "bg-green-500/20 text-green-700"
                  : "bg-red-500/20 text-red-700"
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>
        <Button onClick={() => { setExam(null); setResult(null); setCurrentIdx(0); setError(null); setAnswer(""); }} size="lg">
          {t("New exam", "امتحان جديد")}
        </Button>
      </div>
    );
  }

  // Exam in progress — show current station
  const station = exam.stations?.[currentIdx];
  if (!station) {
    return (
      <div className="rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
        <h2 className="mb-2 text-2xl font-bold">{t("Could not load stations", "تعذر تحميل المحطات")}</h2>
        <p className="mb-4 text-muted-foreground">
          {t("No stations were found for this exam. Check that OSPE images exist in the correct folder.", "لم يتم العثور على محطات لهذا الامتحان. تأكد من وجود صور OSPE في المجلد الصحيح.")}
        </p>
        <Button onClick={() => router.refresh()} size="lg">{t("Try again", "حاول مرة أخرى")}</Button>
      </div>
    );
  }
  const isTimeWarning = stationTimeLeft <= 10;
  const progress = ((currentIdx + 1) / exam.stations.length) * 100;

  return (
    <div className="grid gap-4">
      {/* Header bar */}
      <div className="flex items-center justify-between rounded-xl bg-card px-5 py-3 ring-1 ring-foreground/10">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground">
            {t("Station", "المحطة")} {currentIdx + 1} / {exam.stations.length}
          </span>
          <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span
            className={`font-mono text-lg font-bold ${
              isTimeWarning ? "text-red-600" : "text-muted-foreground"
            }`}
          >
            {formatTime(stationTimeLeft)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("Remaining", "المتبقي")}: {formatTime(timeLeft)}
          </span>
        </div>
      </div>

      {/* Station image */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="border-b px-5 py-3">
          <h3 className="font-semibold">{station.folder} — {station.fileName}</h3>
        </div>
        <img
          src={moduleSlug && subjectSlug
            ? `/api/practical/ospe/image?module=${encodeURIComponent(moduleSlug)}&subject=${encodeURIComponent(subjectSlug)}&folder=${encodeURIComponent(station.folder)}&file=${encodeURIComponent(station.fileName)}`
            : `/api/content/ospe/image?folder=${encodeURIComponent(station.folder)}&file=${encodeURIComponent(station.fileName)}`}
          alt={`Station ${currentIdx + 1}`}
          className="max-h-[50vh] w-full bg-black object-contain"
        />
      </div>

      {/* Answer input */}
      {error && <p role="alert" className="rounded-lg border border-red-600 bg-red-50 p-4 text-red-950 dark:bg-red-950 dark:text-red-100">{error}</p>}
      <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <label className="mb-2 block text-sm font-medium text-muted-foreground">
          {t("Your answer", "إجابتك")}
        </label>
        <textarea
          value={answer}
          disabled={submitting}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={t("Write the diagnosis and key findings here…", "اكتب التشخيص والعلامات المهمة هنا...")}
          className="h-32 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-3 flex items-center justify-between">
          <Button
            variant="destructive"
            onClick={() => handleSubmitAnswer(true)}
            disabled={submitting}
            size="sm"
          >
            {t("Save and finish exam", "حفظ وإنهاء الامتحان")}
          </Button>
          <Button
            onClick={() => handleSubmitAnswer(Date.now() >= totalDeadlineRef.current)}
            disabled={submitting}
          >
            {submitting ? "جارٍ الإرسال…" : currentIdx === exam.stations.length - 1 ? "إرسال وإنهاء" : "المحطة التالية"}
          </Button>
        </div>
      </div>
    </div>
  );
}
