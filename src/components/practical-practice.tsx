"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Flag, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";
import { PracticalTargetArrow } from "@/components/practical-target-arrow";
import type { Feedback, PracticePayload, Progress } from "@/features/practical/model";

export function PracticalPractice({ moduleSlug, subjectSlug, subjectName, fixtures, wrongOnly }: {
  moduleSlug: string;
  subjectSlug: string;
  subjectName: string;
  fixtures: boolean;
  wrongOnly: boolean;
}) {
  const { t } = useLocale();
  const [data, setData] = useState<PracticePayload | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState(false);
  const [zoom, setZoom] = useState(100);
  const submissionId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const query = new URLSearchParams({ module: moduleSlug, subject: subjectSlug, fixtures: fixtures ? "1" : "0" }).toString();
  const endpoint = `/api/practical?${query}`;
  const base = `/curriculum/${encodeURIComponent(moduleSlug)}/practical/${encodeURIComponent(subjectSlug)}`;
  const fixtureQuery = fixtures ? "?fixtures=1" : "";

  const load = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch(`${endpoint}&mode=${wrongOnly ? "wrong" : "practice"}`, { signal, cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Could not load practical questions");
    return body as PracticePayload;
  }, [endpoint, wrongOnly]);
  const applyLoadedData = useCallback((body: PracticePayload) => {
    setData(body); setIndex(0); setSelected(""); setFeedback({}); setError("");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(applyLoadedData).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [load, applyLoadedData]);

  const question = data?.questions[index];
  const image = data?.images.find((i) => i.id === question?.imageId);
  const state = data?.progress.find((p) => p.questionId === question?.id);
  const result = question ? feedback[question.id] : undefined;

  async function submit() {
    if (!question || !selected || inFlight.current || result) return;
    inFlight.current = true; setBusy(true); setError("");
    submissionId.current ??= crypto.randomUUID();
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.id, optionId: selected, requestId: submissionId.current }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Answer was not confirmed. Please retry.");
      setFeedback((previous) => ({ ...previous, [question.id]: body.feedback }));
      setData((previous) => previous ? { ...previous, progress: body.progress, summary: body.summary } : previous);
      submissionId.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "Answer was not saved. Retry without leaving this question."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function flag(key: "bookmarked" | "difficult") {
    if (!question || inFlight.current) return;
    const value = !state?.[key]; inFlight.current = true; setBusy(true); setError("");
    try {
      const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.id, flag: key, value }) });
      if (!res.ok) throw new Error("Could not save your selection. Please retry.");
      setData((previous) => {
        if (!previous) return previous;
        const existing: Progress = previous.progress.find((p) => p.questionId === question.id) ?? { questionId: question.id, attempts: 0, correct: 0, wrong: 0, wrongRemaining: false, bookmarked: false, difficult: false };
        return { ...previous, progress: [...previous.progress.filter((p) => p.questionId !== question.id), { ...existing, [key]: value }] };
      });
    } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function navigate(next: number) {
    if (inFlight.current) return;
    setIndex(next); setSelected(""); setError(""); setImageError(false); submissionId.current = null;
  }

  return <div className="space-y-6">
    {fixtures && <div role="note" className="rounded-xl border border-amber-600 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      <strong>Development fixtures — NOT verified anatomy questions.</strong>
      <p className="mt-1 text-sm">10 deliberately repetitive, non-medical exercises. These test the interface and persistence only. They are excluded from production and verified banks.</p>
    </div>}
    <nav className="flex flex-wrap gap-3" aria-label="Practical mode">
      <Link aria-current={!wrongOnly ? "page" : undefined} href={`${base}/practice${fixtureQuery}`} className={`rounded-lg border px-4 py-2 ${!wrongOnly ? "bg-primary text-primary-foreground" : "bg-card"}`}>{t("Practice", "تدريب")}</Link>
      <Link aria-current={wrongOnly ? "page" : undefined} href={`${base}/wrong${fixtureQuery}`} className={`rounded-lg border px-4 py-2 ${wrongOnly ? "bg-primary text-primary-foreground" : "bg-card"}`}>{t("Wrong Questions", "الأسئلة الخاطئة")}{data ? ` (${data.summary.wrongRemaining})` : ""}</Link>
    </nav>
    {data && <section aria-label="Practical progress" className="rounded-2xl border bg-card p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {([["Attempted", data.summary.attempted], ["Correct", data.summary.correct], ["Wrong", data.summary.wrong], ["Accuracy", data.summary.accuracy === null ? "—" : `${data.summary.accuracy}%`], ["Wrong remaining", data.summary.wrongRemaining]] as const).map(([label, value]) => <div key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>)}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Counts include retries. Wrong remaining counts questions whose latest answer is incorrect. Practical progress is separate from theory quizzes.</p>
    </section>}
    {error && <div role="alert" className="rounded-lg border border-red-600 bg-red-50 p-4 text-red-950 dark:bg-red-950 dark:text-red-100">{error} {!data && <Button variant="outline" className="ms-3" onClick={() => load().then(applyLoadedData).catch((e: Error) => setError(e.message))}>Retry</Button>}</div>}
    {!data && !error && <p role="status">{t("Loading practical…", "جارٍ تحميل التدريب…")}</p>}
    {data && !question && <div className="rounded-2xl border bg-card p-8">
      <h2 className="text-xl font-semibold">{wrongOnly ? "No wrong questions remaining" : `No approved ${subjectName} practical questions available yet`}</h2>
      <p className="mt-3 text-muted-foreground">{wrongOnly ? "Incorrect answers appear here automatically. A correct retry clears the question from this queue." : "The practical engine is ready for reviewed source material. No unapproved question or random image is shown in this bank."}</p>
    </div>}
    {question && image && <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2" dir="ltr" lang="en">
      <section className="min-w-0 overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b p-4">
          <span className="text-sm font-medium">Target: {question.markerIds.map((id) => `label ${id}`).join(", ") || "whole image"}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" aria-label="Zoom out" disabled={zoom <= 100} onClick={() => setZoom((z) => Math.max(100, z - 25))}><ZoomOut className="size-4" /></Button>
            <span className="text-sm tabular-nums">{zoom}%</span>
            <Button variant="outline" size="sm" aria-label="Zoom in" disabled={zoom >= 250} onClick={() => setZoom((z) => Math.min(250, z + 25))}><ZoomIn className="size-4" /></Button>
          </div>
        </div>
        <div className="max-h-[65vh] overflow-auto bg-white" tabIndex={0} aria-label="Zoomable practical image">
          <div className="relative" style={{ width: `${zoom}%`, filter: "none" }}>
            {/* Native image preserves source colours and aspect ratio; private authenticated URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.alt} className="block h-auto w-full" style={{ filter: "none", objectFit: "contain" }} onError={() => setImageError(true)} onLoad={() => setImageError(false)} />
            {image.markers.map((marker) => <span key={marker.id} aria-label={`Label ${marker.label ?? marker.id}`} className={`absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-slate-950 text-sm font-bold text-white shadow ${question.markerIds.includes(marker.id) ? "ring-4 ring-blue-500" : ""}`} style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}>{marker.label ?? marker.id}</span>)}
            {question.targetX != null && question.targetY != null && (
              <span aria-label={`Spotter arrow at X ${question.targetX.toFixed(3)}, Y ${question.targetY.toFixed(3)}`} className="pointer-events-none absolute z-10" style={{ left: `${question.targetX * 100}%`, top: `${question.targetY * 100}%`, transform: "translate(-50%, -100%)" }}>
                <PracticalTargetArrow className="drop-shadow" />
              </span>
            )}
          </div>
        </div>
        {imageError && <p role="alert" className="p-4 text-destructive">Image unavailable. Answering is disabled until it loads.</p>}
        <p className="border-t p-4 text-xs text-muted-foreground">Shared image · {data.questions.filter((q) => q.imageId === image.id).length} questions in this selection. Zoom does not change image colours.</p>
      </section>
      <section className="min-w-0 space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
        <p className="text-sm font-medium text-primary">Question {index + 1} of {data.questions.length}</p>
        <fieldset disabled={busy || Boolean(result) || imageError} className="space-y-3">
          <legend className="mb-5 text-xl font-semibold leading-relaxed">{question.prompt}</legend>
          {question.options.map((option, i) => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${selected === option.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}>
            <input type="radio" name={question.id} value={option.id} checked={selected === option.id} onChange={() => { setSelected(option.id); submissionId.current = null; }} className="mt-1 accent-[var(--primary)]" />
            <span><span className="me-2 font-semibold">{String.fromCharCode(65 + i)}.</span>{option.text}</span>
          </label>)}
        </fieldset>
        {!result && <Button onClick={submit} disabled={!selected || busy || imageError} className="w-full">{busy ? "Saving…" : "Submit answer"}</Button>}
        {result && <div aria-live="polite" className="space-y-4 border-t pt-5">
          <p className={`rounded-lg border p-3 font-semibold ${result.correct ? "border-emerald-600 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100" : "border-red-600 bg-red-50 text-red-950 dark:bg-red-950 dark:text-red-100"}`}>{result.correct ? "Correct" : "Incorrect — saved to Practical Wrong Questions"}</p>
          <p><strong>Correct answer: </strong>{result.correctAnswer}</p>
          {([["Why", result.explanation], ["Identifying clue", result.identifyingClue], ["Common mistake", result.commonMistake], ["Exam tip", result.examTip]] as const).map(([label, text]) => <div key={label}><h3 className="font-semibold">{label}</h3><p className="mt-1 leading-relaxed text-muted-foreground">{text}</p></div>)}
          <div className="rounded-lg bg-muted p-3 text-sm"><strong>Source: </strong>{result.sourceMaterial.title} — page {result.sourcePage}<p className="mt-1 break-words text-xs text-muted-foreground">{result.sourceMaterial.path}</p></div>
        </div>}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" disabled={busy} aria-pressed={state?.bookmarked ?? false} onClick={() => flag("bookmarked")}><Bookmark className="size-4" />{state?.bookmarked ? "Bookmarked" : "Bookmark"}</Button>
          <Button variant="outline" disabled={busy} aria-pressed={state?.difficult ?? false} onClick={() => flag("difficult")}><Flag className="size-4" />{state?.difficult ? "Marked difficult" : "Mark difficult"}</Button>
        </div>
        <div className="flex justify-between gap-3">
          <Button variant="outline" disabled={index === 0 || busy} onClick={() => navigate(index - 1)}>Previous</Button>
          <Button variant="outline" disabled={index >= data.questions.length - 1 || busy} onClick={() => navigate(index + 1)}>Next</Button>
        </div>
      </section>
    </div>}
  </div>;
}
