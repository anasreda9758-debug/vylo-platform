"use client";

import { useEffect, useState } from "react";
import { BookmarkPlus, Loader2, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";

type Note = {
  id: string;
  body: string;
  highlightedText: string | null;
  updatedAt: string;
};

export function LectureNotes({ lectureId }: { lectureId: string }) {
  const { locale, t } = useLocale();
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [highlightedText, setHighlightedText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/lecture-notes?lectureId=${encodeURIComponent(lectureId)}`)
      .then((response) => response.ok ? response.json() : { notes: [] })
      .then((data: { notes: Note[] }) => setNotes(data.notes ?? []))
      .catch(() => {});
  }, [lectureId]);

  async function save() {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/lecture-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lectureId, body, highlightedText }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.note) {
        setNotes((current) => [data.note, ...current]);
        setBody("");
        setHighlightedText("");
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setNotes((current) => current.filter((note) => note.id !== id));
    await fetch(`/api/lecture-notes?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <StickyNote className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-semibold">{t("Notes & highlights", "الملاحظات والتظليل")}</h2>
          <p className="text-sm text-muted-foreground">{t("Private notes saved to this lecture.", "ملاحظاتك الخاصة محفوظة لهذه المحاضرة.")}</p>
        </div>
      </div>
      <div className="grid gap-3">
        <input
          aria-label={t("Highlighted term (optional)", "مصطلح مظلل (اختياري)")}
          value={highlightedText}
          onChange={(event) => setHighlightedText(event.target.value)}
          placeholder={t("Key term or highlighted phrase (optional)", "مصطلح أو عبارة مهمة (اختياري)")}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <textarea
          aria-label={t("Private lecture note", "ملاحظة خاصة للمحاضرة")}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t("Write a concise note, clinical pearl, or memory aid…", "اكتب ملاحظة أو نقطة سريرية أو وسيلة تذكر…")}
          rows={3}
          dir={locale === "ar" ? "rtl" : "ltr"}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div>
          <Button className="min-h-11" onClick={save} disabled={!body.trim() || saving}>
            {saving ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <BookmarkPlus className="me-1 h-4 w-4" />}
            {t("Save note", "حفظ الملاحظة")}
          </Button>
        </div>
      </div>
      {notes.length > 0 && (
        <ul className="mt-5 space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {note.highlightedText && <p className="mb-1 font-medium text-primary">{note.highlightedText}</p>}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.body}</p>
                </div>
                <button onClick={() => remove(note.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={t("Delete note", "حذف الملاحظة")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
