"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeftRight, CheckCircle2, XCircle, Eye } from "lucide-react";

interface ReviewQuestion {
  id: string;
  questionType: string;
  reviewStatus: string;
  status: string;
  prompt: string;
  sourceMaterial: { pdf?: string; page?: number } | null;
  sourcePage: number | null;
  imageId: string;
  groupId: string;
  order: number;
  correctOptionId: string;
  options?: { id: string; text: string }[];
}

export function PracticalContentReview() {
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/practical-review")
      .then((r) => r.json())
      .then((d) => { setQuestions(d.questions ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function action(questionId: string, act: "approve" | "reject") {
    const res = await fetch("/api/admin/practical-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, action: act }),
    });
    if (res.ok) {
      setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, reviewStatus: act === "approve" ? "APPROVED" : "REJECTED", status: act === "approve" ? "APPROVED" : "REJECTED" } : q)));
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">جاري تحميل أسئلة المراجعة…</p>;

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">مراجعة المحتوى المصدري</h2>
      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد أسئلة لعرضها.</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <Card key={q.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">{q.id}</span>
                    <span className="text-xs rounded bg-muted px-2 py-0.5">{q.questionType}</span>
                    <span className={`text-xs font-semibold rounded px-2 py-0.5 ${
                      q.reviewStatus === "APPROVED" ? "bg-green-100 text-green-800" :
                      q.reviewStatus === "REJECTED" ? "bg-red-100 text-red-800" :
                      q.reviewStatus === "AUTO_VERIFIED_SOURCE" ? "bg-blue-100 text-blue-800" :
                      "bg-amber-100 text-amber-800"
                    }`}>{q.reviewStatus}</span>
                  </div>
                  <p className="mt-1 text-sm truncate" title={q.prompt}>{q.prompt}</p>
                  <p className="text-xs text-muted-foreground">
                    المصدر: {q.sourceMaterial?.pdf ?? "—"} — صفحة {q.sourcePage ?? "—"}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setExpandedId(expandedId === q.id ? null : q.id)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => action(q.id, "approve")} disabled={q.reviewStatus === "APPROVED"}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => action(q.id, "reject")} disabled={q.reviewStatus === "REJECTED"}>
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {expandedId === q.id && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs border-t pt-3">
                  <div className="space-y-1">
                    <p className="font-semibold">النسخة المصدرية</p>
                    <p className="p-2 rounded bg-muted">{q.prompt}</p>
                    <p className="text-muted-foreground">PDF: {q.sourceMaterial?.pdf} | صفحة: {q.sourcePage}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold">نسخة الطالب</p>
                    <p className="p-2 rounded bg-muted">{q.prompt}</p>
                    <p className="text-muted-foreground">الخيارات: {(q.options ?? []).map((o) => o.text).join(" / ")}</p>
                    <p className="text-muted-foreground">لا يُعرض الإجابة للطالب.</p>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
