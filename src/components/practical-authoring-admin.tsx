"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { PracticalTargetArrow } from "@/components/practical-target-arrow";
import { imageDisplayBox, normalizedTargetFromPoint } from "@/features/practical/geometry";
import { RefreshCw, CheckCircle2, XCircle, Upload, Eye, Crosshair, Save } from "lucide-react";

type CatalogImage = {
  id: string;
  alt: string;
  storageKey: string;
  status: string;
  subject?: string;
  studyYear?: number;
  isExamDerivative?: boolean;
  isFixture?: boolean;
  reviewStatus?: string;
  markers?: unknown;
  [k: string]: unknown;
};

type CatalogQuestion = {
  id: string;
  prompt: string;
  correctStructure?: string | null;
  reviewStatus?: string;
  status?: string;
  options?: { id: string; text: string }[];
  correctOptionId?: string;
  targetX?: number | null;
  targetY?: number | null;
  imageId?: string;
  [k: string]: unknown;
};

type CatalogItem = {
  image: CatalogImage | null;
  raw: CatalogImage;
  questions: { question: CatalogQuestion | null; raw: CatalogQuestion }[];
};

const ADMIN_IMAGE = (id: string) => `/api/admin/practical-images/${encodeURIComponent(id)}`;

function PracticalImageState({ id, src, alt, className }: { id: string; src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex min-h-40 w-full flex-col items-center justify-center gap-1 rounded border border-destructive/40 bg-destructive/5 p-4 text-center">
        <p className="text-sm font-medium text-destructive">تعذر تحميل الصورة</p>
        <p className="max-w-full break-all text-xs text-muted-foreground">id: {id}</p>
        <button className="mt-1 text-xs text-primary underline" onClick={() => setFailed(false)}>إعادة المحاولة</button>
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.text();
  if (!res.ok) throw new Error(body ? JSON.parse(body).error ?? res.statusText : res.statusText);
  return JSON.parse(body) as T;
}

export function PracticalAuthoringAdmin() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<{ catalog: CatalogItem[] }>("/api/admin/practical-authoring");
        if (!cancelled) setCatalog(data.catalog);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = async () => {
    setBusy(true);
    try {
      const data = await api<{ catalog: CatalogItem[] }>("/api/admin/practical-authoring");
      setCatalog(data.catalog);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api("/api/admin/practical-authoring", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      await load();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selected = catalog.find((c) => c.raw.id === selectedImageId) ?? null;
  const artifacts = catalog.filter((c) => c.raw.sourceImageId === selectedImageId || c.raw.id === selectedImageId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">صور الامتحانات العملية</h2>
          <p className="text-sm text-muted-foreground">المصدر الأصلي + النسخ النظيفة المشتقة + الأسئلة</p>
        </div>
        <Button type="button" variant="outline" onClick={load} disabled={busy}>
          <RefreshCw className="mr-2 h-4 w-4" />
          تحديث
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {catalog.map((item) => (
          <button
            key={item.raw.id}
            type="button"
            onClick={() => {
              setSelectedImageId(item.raw.id);
              setPreview(null);
            }}
            className={`rounded-xl border p-4 text-right transition ${
              selectedImageId === item.raw.id ? "border-primary bg-accent/50" : "border-border hover:bg-accent/30"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{item.image?.alt ?? item.raw.alt}</span>
              {item.raw.isExamDerivative ? (
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600">نظيفة</span>
              ) : (
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">مصدر</span>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {item.raw.subject} · سنة {item.raw.studyYear} · {item.questions.length} سؤال
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className={item.raw.reviewStatus === "APPROVED" ? "text-emerald-600" : "text-muted-foreground"}>
                {item.raw.reviewStatus ?? item.raw.status}
              </span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <OriginalPanel source={selected} selected={selectedImageId!} onChange={setSelectedImageId} artifacts={artifacts} onPatch={patch} busy={busy} />
          <CleanPanel source={selected} onPatch={patch} busy={busy} />
        </div>
      )}

      {selected?.questions.filter((q) => q.raw.id).map((q) => (
        <QuestionPanel key={q.raw.id} q={q} selectedImageId={selectedImageId!} onPatch={patch} onPreview={async () => {
          setBusy(true);
          try {
            setPreview(await api(`/api/admin/practical-authoring?preview=${q.raw.id}`));
            setError(null);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }} busy={busy} />
      ))}

      {preview && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">معاينة الطالب (البايلود قبل الإجابة)</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => setPreview(null)}>إغلاق</Button>
          </div>
          <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(preview, null, 2)}</pre>
        </Card>
      )}
    </div>
  );
}

function OriginalPanel({ source, artifacts, onPatch, busy }: {
  source: CatalogItem;
  selected: string;
  onChange: (id: string) => void;
  artifacts: CatalogItem[];
  onPatch: (p: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const img = source.raw;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">الصورة المصدرية (الأصلية)</h3>
        {img.reviewStatus === "APPROVED" ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-4 w-4" /> معتمدة</span>
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <PracticalImageState
        id={img.id}
        src={ADMIN_IMAGE(img.id)}
        alt={img.alt}
        className="max-h-72 w-full rounded object-contain"
      />
      <p className="mt-2 text-xs text-muted-foreground">{img.alt}</p>
      <p className="text-xs text-muted-foreground">storageKey: {img.storageKey}</p>
      {!!(img.markers as { label?: string }[] | undefined)?.length && (
        <p className="mt-1 text-xs text-muted-foreground">
          markers: {(img.markers as { label?: string }[]).map((m) => m.label ?? m).join(", ")}
        </p>
      )}
      {img.status === "APPROVED" && img.reviewStatus !== "APPROVED" && (
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => onPatch({ action: "approve-image", imageId: img.id })}>
            اعتماد الصورة
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onPatch({ action: "reject-image", imageId: img.id })}>
            رفض
          </Button>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">الأسئلة المرتبطة بنفس النسخة النظيفة {artifacts.length}</p>
    </Card>
  );
}

function CleanPanel({ source, onPatch, busy }: {
  source: CatalogItem;
  onPatch: (p: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const ext = "." + file.name.split(".").pop()!.toLowerCase();
    const reader = new FileReader();
    reader.onload = () => {
      const raw = (reader.result as string).split(",")[1];
      void onPatch({ action: "upload-clean", sourceImageId: source.raw.id, filename: `clean${ext}`, dataBase64: raw });
    };
    reader.readAsDataURL(file);
  };

  const cleanQuestion = source.questions.find((q) => q.raw.examImageId === source.raw.id || q.raw.imageId === source.raw.id);
  const examImageId = (cleanQuestion?.raw.examImageId as string) ?? null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">النسخة النظيفة للامتحان</h3>
        <span className="text-xs text-muted-foreground">يتعرض لها الطالب فقط</span>
      </div>

      {examImageId ? (
        <>
          <PracticalImageState
            id={examImageId}
            src={ADMIN_IMAGE(examImageId)}
            alt="Clean exam version"
            className="max-h-72 w-full rounded object-contain"
          />
          <p className="mt-2 text-xs text-muted-foreground">تم الرفع — imageId {examImageId}</p>
        </>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center hover:bg-accent/30">
          <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">رفع نسخة نظيفة (بدون تسميات) من هذه الصورة</span>
          <span className="mt-1 text-xs text-muted-foreground">PNG / JPG / WebP — حتى 8 MB</span>
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      )}

      {examImageId && (
        <Button type="button" size="sm" variant="outline" className="mt-3" disabled={busy}
          onClick={() => {
            void onPatch({ action: "approve-image", imageId: examImageId });
          }}>
          اعتماد النسخة النظيفة
        </Button>
      )}
    </Card>
  );
}

function QuestionPanel({ q, selectedImageId, onPatch, onPreview, busy }: {
  q: CatalogItem["questions"][number];
  selectedImageId: string;
  onPatch: (p: Record<string, unknown>) => void;
  onPreview: () => void;
  busy: boolean;
}) {
  const data = q.raw;
  const [targetX, setTargetX] = useState(data.targetX ?? 0.5);
  const [targetY, setTargetY] = useState(data.targetY ?? 0.5);
  const [structure, setStructure] = useState(data.correctStructure ?? "");
  const [options, setOptions] = useState<{ id: string; text: string }[]>(
    (data.options ?? []).map((o) => ({ id: o.id, text: o.text })),
  );
  const [correct, setCorrect] = useState(data.correctOptionId ?? data.options?.[0]?.id ?? "");

  const statusChip = data.reviewStatus ?? data.status;
  const color = statusChip === "APPROVED" ? "text-emerald-600" : statusChip === "REJECTED" ? "text-destructive" : "text-muted-foreground";
  const examImageId = (data.examImageId ?? data.imageId) as string | undefined;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">سؤال {data.id.slice(0, 8)}</h3>
        <span className={`text-xs ${color}`}>{statusChip}</span>
      </div>

      {examImageId && (
        <div className="mt-4 space-y-2">
          <Label>انقر على الصورة لتحديد موضع السهم (اسحب لضبطه)</Label>
          <TargetCanvas
            image={examImageId}
            targetX={targetX}
            targetY={targetY}
            onChange={(x, y) => { setTargetX(x); setTargetY(y); }}
          />
          <p className="text-xs text-muted-foreground">
            normalized: X {targetX.toFixed(3)} · Y {targetY.toFixed(3)}
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>موضع السهم X (0..1)</Label>
          <Input type="number" min={0} max={1} step={0.01} value={targetX} onChange={(e) => setTargetX(Number(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label>موضع السهم Y (0..1)</Label>
          <Input type="number" min={0} max={1} step={0.01} value={targetY} onChange={(e) => setTargetY(Number(e.target.value))} />
        </div>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <Button type="button" size="sm" disabled={busy}
          onClick={() => void onPatch({ action: "update-target", questionId: data.id, targetX, targetY })}>
          <Crosshair className="mr-1 h-4 w-4" /> حفظ الموضع
        </Button>
      </div>

      <div className="mt-4 space-y-1">
        <Label>البنية الصحيحة (تحقق يدوي — لا يُخمَّن بالذكاء الاصطناعي)</Label>
        <div className="flex gap-2">
          <Input value={structure} onChange={(e) => setStructure(e.target.value)} />
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => void onPatch({ action: "set-structure", questionId: data.id, correctStructure: structure })}>
            <Save className="mr-1 h-4 w-4" /> حفظ
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Label>الخيارات الخمسة (صحيح واحد)</Label>
        {options.map((o, i) => (
          <div key={o.id} className="flex items-center gap-2">
            <input
              type="radio"
              name={`correct-${data.id}`}
              checked={correct === o.id}
              onChange={() => {
                setCorrect(o.id);
                void onPatch({ action: "set-correct-option", questionId: data.id, optionId: o.id });
              }}
            />
            <span className="text-xs text-muted-foreground">{o.id}</span>
            <Input
              value={o.text}
              onChange={(e) => {
                const next = options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x));
                setOptions(next);
              }}
            />
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" disabled={busy}
          onClick={() => void onPatch({ action: "update-options", questionId: data.id, options, correctOptionId: correct })}>
          حفظ الخيارات
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onPreview}>
          <Eye className="mr-1 h-4 w-4" /> معاينة الطالب
        </Button>
        {statusChip !== "APPROVED" && (
          <Button type="button" size="sm" disabled={busy}
            onClick={() => void onPatch({ action: "approve-question", questionId: data.id })}>
            اعتماد ونشر
          </Button>
        )}
        {statusChip !== "REJECTED" && (
          <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => void onPatch({ action: "reject-question", questionId: data.id })}>
            رفض
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Owner-review surface: the CLEAN exam image with a drag/click arrow overlay.
 * The click is mapped against the RENDERED IMAGE bounds (with object-fit:contain
 * letterboxing removed), so normalized 0..1 always refers to the image itself,
 * never the surrounding card. Arrow tip is anchored at translate(-50%, -100%).
 */
function TargetCanvas({ image, targetX, targetY, onChange }: {
  image: string;
  targetX: number;
  targetY: number;
  onChange: (x: number, y: number) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  const setFromPoint = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // Normalize against the ACTUAL rendered image area (letterbox excluded),
    // never the surrounding card.
    const box = imageDisplayBox(rect, natural, img.style.objectFit);
    const { x, y } = normalizedTargetFromPoint({ x: clientX, y: clientY }, box);
    onChange(x, y);
  };

  if (failed) {
    return (
      <div className="flex min-h-40 w-full flex-col items-center justify-center gap-1 rounded border border-destructive/40 bg-destructive/5 p-4 text-center">
        <p className="text-sm font-medium text-destructive">تعذر تحميل الصورة</p>
        <p className="max-w-full break-all text-xs text-muted-foreground">id: {image}</p>
        <button className="mt-1 text-xs text-primary underline" onClick={() => setFailed(false)}>إعادة المحاولة</button>
      </div>
    );
  }

  return (
    <div
      dir="ltr"
      className="relative w-full cursor-crosshair select-none overflow-hidden rounded-lg border"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromPoint(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) setFromPoint(e.clientX, e.clientY);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={ADMIN_IMAGE(image)}
        alt="Clean exam image — click to place the arrow"
        className="block h-auto w-full"
        style={{ objectFit: "contain" }}
        onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        onError={() => setFailed(true)}
      />
      {targetX != null && targetY != null && (
        <span
          aria-label={`Arrow at X ${targetX.toFixed(3)}, Y ${targetY.toFixed(3)}`}
          className="pointer-events-none absolute z-10"
          style={{ left: `${targetX * 100}%`, top: `${targetY * 100}%`, transform: "translate(-50%, -100%)" }}
        >
          <PracticalTargetArrow className="drop-shadow" />
        </span>
      )}
    </div>
  );
}