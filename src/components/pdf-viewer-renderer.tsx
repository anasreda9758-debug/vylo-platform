"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, Maximize2, Minimize2,
  Search, X, PanelLeftClose, PanelLeftOpen, AlertTriangle, FileWarning, Loader2, RotateCcw,
} from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import {
  clampPage, clampScale, fitPageScale, fitWidthScale, findSearchHits, hasSearchableText,
  readerShortcut, resolveRange, stepHit, thumbnailWindow, ZOOM_STEP, type FitMode, type SearchHit,
} from "./pdf-reader-logic";

// Browser-only: pdf.js relies on DOMMatrix and other DOM globals.
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type FitState = {
  width: number;
  height: number;
  pageWidthPt: number;
  pageHeightPt: number;
};

const SearchPanel = ({
  query, onQuery, hits, active, onStep, onClose, available, t,
}: {
  query: string;
  onQuery: (q: string) => void;
  hits: SearchHit[];
  active: number;
  onStep: (delta: number) => void;
  onClose: () => void;
  available: boolean;
  t: (en: string, ar: string) => string;
}) => (
  <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
    <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <input
      autoFocus
      value={query}
      onChange={(e) => onQuery(e.target.value)}
      placeholder={available ? t("Search in this lecture", "ابحث في هذه المحاضرة") : t("Search unavailable for this document", "البحث غير متاح لهذا المستند")}
      disabled={!available}
      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      aria-label={t("Search in this document", "البحث في هذا المستند")}
    />
    {available ? (
      <>
        <span className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
          {query.trim().length < 2
            ? t("Type 2+ characters", "اكتب حرفين أو أكثر")
            : hits.length === 0
              ? t("No matches", "لا نتائج")
              : `${active + 1} / ${hits.length}`}
        </span>
        <Button variant="ghost" size="icon" onClick={() => onStep(-1)} disabled={!hits.length} aria-label={t("Previous match", "النتيجة السابقة")}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onStep(1)} disabled={!hits.length} aria-label={t("Next match", "النتيجة التالية")}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </>
    ) : null}
    <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("Close search", "إغلاق البحث")}>
      <X className="h-4 w-4" />
    </Button>
  </div>
);

export function PdfViewerRenderer({
  lectureId,
  title,
  pageStart,
  pageEnd,
}: {
  lectureId: string;
  title: string;
  pageStart?: number | null;
  pageEnd?: number | null;
}) {
  const { t } = useLocale();
  const pdfUrl = `/api/content/pdf/${lectureId}`;
  // react-pdf v10 does not export usePDF, so the document proxy is captured from
  // <Document onLoadSuccess>, which is the same PDFDocumentProxy.
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const numPages = pdf?.numPages ?? 0;
  const { min: minPage, max: maxPage, hasRange } = useMemo(
    () => resolveRange(numPages, pageStart, pageEnd),
    [numPages, pageStart, pageEnd],
  );

  const [pageNumber, setPageNumber] = useState(() => (pageStart && pageStart > 0 ? pageStart : 1));
  const [fitMode, setFitMode] = useState<FitMode>("width");
  const [customScale, setCustomScale] = useState(1.2);
  const [focus, setFocus] = useState(false);
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeHitRaw, setActiveHitRaw] = useState(0);
  const [pageTexts, setPageTexts] = useState<Array<{ page: number; text: string }>>([]);
  const [searchChecked, setSearchChecked] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<FitState>({ width: 0, height: 0, pageWidthPt: 595, pageHeightPt: 842 });

  // Measure the viewport so fit-width / fit-page stay correct on resize.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setFit((f) => ({ ...f, width: el.clientWidth, height: el.clientHeight }));
    });
    ro.observe(el);
    setFit((f) => ({ ...f, width: el.clientWidth, height: el.clientHeight }));
    return () => ro.disconnect();
  }, [focus]);

  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const effectivePageW = pageSize?.width ?? fit.pageWidthPt;
  const effectivePageH = pageSize?.height ?? fit.pageHeightPt;

  const scale = useMemo(() => {
    if (fitMode === "width") return fitWidthScale(fit.width, effectivePageW);
    if (fitMode === "page") return fitPageScale(fit.width, fit.height, effectivePageW, effectivePageH);
    return clampScale(customScale);
  }, [fitMode, fit.width, fit.height, effectivePageW, effectivePageH, customScale]);

  const goTo = useCallback((p: number) => setPageNumber((cur) => clampPage(p, minPage, maxPage)), [minPage, maxPage]);

  // Search the text layer lazily, and only while the panel is open.
  useEffect(() => {
    if (!searchOpen || !pdf || searchChecked) return;
    let cancelled = false;
    (async () => {
      const out: Array<{ page: number; text: string }> = [];
      for (let p = 1; p <= numPages; p++) {
        if (cancelled) return;
        try {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          out.push({ page: p, text: content.items.map((i) => ("str" in i ? i.str : "")).join(" ") });
        } catch {
          /* a single unreadable page must not break search */
        }
        if (p % 10 === 0) setPageTexts([...out]);
      }
      if (!cancelled) {
        setPageTexts(out);
        setSearchChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchOpen, pdf, numPages, searchChecked]);

  const searchAvailable = searchChecked && hasSearchableText(pageTexts.reduce((s, p) => s + p.text.length, 0));

  // Derived rather than stored, so searching never costs an extra render pass
  // and can never desynchronise from the query.
  const hits = useMemo(() => findSearchHits(pageTexts, query), [pageTexts, query]);
  const activeHit = Math.min(activeHitRaw, Math.max(0, hits.length - 1));

  const stepSearch = useCallback(
    (delta: number) => {
      if (!hits.length) return;
      const next = stepHit(hits, activeHit, delta);
      setActiveHitRaw(next);
      const hit = hits[next];
      if (hit) goTo(hit.page);
    },
    [hits, activeHit, goTo],
  );

  // Keyboard shortcuts, ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = !!target && /^(INPUT|TEXTAREA)$/.test(target.tagName);
      const action = readerShortcut(e.key, inInput);
      if (!action) return;
      switch (action) {
        case "first": goTo(minPage); break;
        case "prev": goTo(pageNumber - 1); break;
        case "next": goTo(pageNumber + 1); break;
        case "last": goTo(maxPage); break;
        case "zoomIn": setFitMode("custom"); setCustomScale((s) => clampScale(s + ZOOM_STEP)); break;
        case "zoomOut": setFitMode("custom"); setCustomScale((s) => clampScale(s - ZOOM_STEP)); break;
        case "search": setSearchOpen((o) => !o); break;
        case "thumbnails": setThumbsOpen((o) => !o); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, minPage, maxPage, pageNumber]);

  const thumbPages = useMemo(() => thumbnailWindow(pageNumber, numPages, 3), [pageNumber, numPages]);

  if (error) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-8 text-center" role="alert">
        <FileWarning className="h-9 w-9 text-amber-500" aria-hidden="true" />
        <p className="font-medium">{t("This PDF could not be opened", "تعذر فتح هذا الملف")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("The file may be missing, or your access may have changed. Refresh, or continue with the lecture notes below.", "قد يكون الملف مفقودًا أو تكون صلاحية الوصول قد تغيرت. حدّث الصفحة، أو تابع بملاحظات المحاضرة بالأسفل.")}
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RotateCcw className="h-4 w-4" />
          {t("Try again", "حاول مرة أخرى")}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-border bg-card ${focus ? "fixed inset-0 z-50 rounded-none" : ""}`}
    >
      {/* sticky toolbar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setThumbsOpen((v) => !v)} aria-label={t("Toggle thumbnails", "إظهار المصغرات")} aria-pressed={thumbsOpen} className={thumbsOpen ? "bg-accent" : ""}>
            {thumbsOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setSearchOpen((v) => !v)} aria-label={t("Search", "بحث")} aria-pressed={searchOpen} className={searchOpen ? "bg-accent" : ""}>
            <Search className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={pageNumber <= minPage} onClick={() => goTo(pageNumber - 1)} aria-label={t("Previous page", "الصفحة السابقة")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="number"
              value={pageNumber}
              min={minPage}
              max={maxPage}
              onChange={(e) => goTo(Number(e.target.value))}
              aria-label={t("Page number", "رقم الصفحة")}
              className="h-8 w-14 rounded-md border border-border bg-background px-2 text-center text-xs outline-none focus:ring-2 focus:ring-ring"
            />
            <span dir="ltr">/ {maxPage}</span>
          </label>
          <Button variant="ghost" size="icon" disabled={pageNumber >= maxPage} onClick={() => goTo(pageNumber + 1)} aria-label={t("Next page", "الصفحة التالية")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => { setFitMode("custom"); setCustomScale((s) => clampScale(s - ZOOM_STEP)); }} aria-label={t("Zoom out", "تصغير")}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => { setFitMode("custom"); setCustomScale((s) => clampScale(s + ZOOM_STEP)); }} aria-label={t("Zoom in", "تكبير")}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="ms-1 hidden items-center gap-1 sm:flex" role="group" aria-label={t("Fit mode", "وضع العرض")}>
            <Button variant={fitMode === "width" ? "secondary" : "ghost"} size="sm" onClick={() => setFitMode("width")} className="h-8 text-xs">
              {t("Width", "العرض")}
            </Button>
            <Button variant={fitMode === "page" ? "secondary" : "ghost"} size="sm" onClick={() => setFitMode("page")} className="h-8 text-xs">
              {t("Page", "الصفحة")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setFitMode("custom"); setCustomScale(1); }} className="h-8 text-xs" aria-label={t("Reset zoom", "إعادة ضبط التكبير")}>
              100%
            </Button>
          </div>
        </div>

        <div className="ms-auto flex items-center gap-1">
          {hasRange ? (
            <span className="hidden rounded-full bg-primary/10 px-2.5 py-1 text-[11px] text-primary lg:inline">
              {t(`Pages ${minPage}–${maxPage}`, `صفحات ${minPage}–${maxPage}`)}
            </span>
          ) : null}
          <a
            href={pdfUrl}
            download
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("Download original", "تحميل الأصل")}
            aria-label={t("Download original", "تحميل الأصل")}
          >
            <Download className="h-4 w-4" />
          </a>
          <Button variant="ghost" size="icon" onClick={() => setFocus((v) => !v)} aria-label={focus ? t("Exit focus mode", "إنهاء وضع التركيز") : t("Focus mode", "وضع التركيز")}>
            {focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {searchOpen ? (
        <SearchPanel
          query={query}
          onQuery={setQuery}
          hits={hits}
          active={activeHit}
          onStep={stepSearch}
          onClose={() => setSearchOpen(false)}
          available={!!searchAvailable}
          t={t}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        {thumbsOpen ? (
          <aside className="hidden w-40 shrink-0 overflow-y-auto border-e border-border bg-muted/30 p-2 sm:block" aria-label={t("Page thumbnails", "مصغرات الصفحات")}>
            <p className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">{t("Pages", "الصفحات")}</p>
            <ul className="space-y-2">
              {thumbPages.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => goTo(p)}
                    aria-current={p === pageNumber ? "page" : undefined}
                    className={`w-full overflow-hidden rounded-lg border-2 transition ${p === pageNumber ? "border-primary" : "border-transparent hover:border-border"}`}
                  >
                    <Document file={pdfUrl}>
                      <Page pageNumber={p} scale={0.22} renderAnnotationLayer={false} renderTextLayer={false} loading={<div className="h-24 w-full animate-pulse bg-muted" />} />
                    </Document>
                    <span className="block bg-card py-0.5 text-[10px] text-muted-foreground">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        <div
          ref={scrollRef}
          className="min-h-[60vh] flex-1 overflow-auto bg-muted p-2 sm:p-4"
          style={focus ? { height: "calc(100vh - 7rem)" } : undefined}
        >
          {loading ? (
            <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("Loading document…", "جارٍ تحميل المستند…")}
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="overflow-hidden rounded-lg shadow-lg" style={{ background: "#fff" }}>
                <Document
                  file={pdfUrl}
                  onLoadSuccess={(doc: PDFDocumentProxy) => {
                    setPdf(doc);
                    setLoading(false);
                    setError(null);
                  }}
                  onLoadError={(e: Error) => {
                    setLoading(false);
                    setError(e);
                  }}
                >
                  <Page
                    pageNumber={clampPage(pageNumber, minPage, maxPage)}
                    scale={scale}
                    renderAnnotationLayer
                    renderTextLayer
                    onLoadSuccess={(p: { width: number; height: number }) => setPageSize({ width: p.width, height: p.height })}
                    loading={
                      <div className="flex h-96 w-[70vw] items-center justify-center" style={{ background: "#fff" }}>
                        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
                      </div>
                    }
                    error={
                      <div className="flex h-96 w-[70vw] flex-col items-center justify-center gap-2 text-center" style={{ background: "#fff" }}>
                        <AlertTriangle className="h-6 w-6 text-amber-500" />
                        <span className="text-sm text-neutral-700">{t("This page could not be displayed", "تعذر عرض هذه الصفحة")}</span>
                      </div>
                    }
                  />
                </Document>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        {t("Tip: use ← → to turn pages, + / − to zoom, F for search, T for thumbnails.", "تلميح: استخدم ← → للتنقل بين الصفحات، و+ / − للتكبير، وF للبحث، وT للمصغرات.")}
      </p>
    </div>
  );
}
