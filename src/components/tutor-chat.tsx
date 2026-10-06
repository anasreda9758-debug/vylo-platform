"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, ThumbsUp, ThumbsDown, BookOpen } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: { lectureTitle: string; moduleSlug: string }[];
  rating?: "up" | "down" | null;
};

export function TutorChat({ lectureId }: { lectureId: string }) {
  const { t } = useLocale();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send(replayMessages?: Message[]) {
    const content = replayMessages
      ? replayMessages[replayMessages.length - 1]?.content ?? ""
      : input.trim();
    if (!content || busy) return;

    // Keep exactly one copy of the user's message. The previous version added
    // it to the history and then appended it once again, which produced the
    // duplicated black bubbles visible in the tutor.
    const outgoing: Message[] = replayMessages ?? [...messages, { role: "user", content }];
    setMessages(outgoing);
    if (!replayMessages) {
      setInput("");
    }
    setBusy(true);
    setError(null);
    setStreaming("");

    try {
      const res = await fetch("/api/tutor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lectureId,
          messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setLimitReached(true);
        setError(data.message ?? t("You have reached today's free limit.", "وصلت إلى الحد المجاني اليوم."));
        return;
      }
      if (!res.ok) {
        setError(t("The study tutor could not be reached. Please try again.", "حدث خطأ أثناء الاتصال بالمعلم الذكي. حاول مجددًا."));
        return;
      }

      // Parse sources from header
      let sources: { lectureTitle: string; moduleSlug: string }[] = [];
      try {
        const srcHeader = res.headers.get("X-Sources");
        if (srcHeader) sources = JSON.parse(srcHeader);
      } catch {}

      // `toTextStreamResponse()` returns plain text, whereas data-stream
      // responses use `0:"..."` lines. Support both formats so a valid local
      // fallback cannot disappear silently in the chat window.
      const rawText = await res.text();
      const encodedLines = rawText.split("\n").filter((line) => line.startsWith("0:"));
      const fullText = encodedLines.length
        ? encodedLines.map((line) => {
            try { return JSON.parse(line.slice(2)); } catch { return line.slice(2); }
          }).join("")
        : rawText.trim();

      if (fullText) {
        setMessages((prev) => [...prev, { role: "assistant", content: fullText, sources, rating: null }]);
      } else {
        setError(t("The study tutor returned no readable response. Please try again.", "لم يصل رد مقروء من المعلم. حاول مرة أخرى."));
      }
    } catch {
      setError(t("Could not connect to the study tutor.", "تعذّر الاتصال بالمعلم الذكي."));
    } finally {
      setBusy(false);
      setStreaming("");
    }
  }

  function regenerate(idx: number) {
    const msg = messages[idx];
    if (msg.role !== "assistant") return;
    // Remove this message and everything after, then resend from the user message before it
    const replay = messages.slice(0, idx);
    const userMsg = replay[replay.length - 1];
    if (userMsg?.role === "user") {
      void send(replay);
    }
  }

  function rate(idx: number, rating: "up" | "down") {
    setMessages((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, rating } : m)),
    );
  }

  function handleSuggestionClick(suggestionText: string) {
    // Only set the input, do NOT send automatically
    setInput(suggestionText);
  }

  return (
    <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
      <div className="flex h-96 flex-col gap-3 overflow-y-auto pe-2">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t("Ask about this lecture's content…", "ابدأ بسؤال عن محتوى هذه المحاضرة…")}
            </p>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground">{t("Suggestions", "اقتراحات:")}</p>
              <Button
                variant="outline"
                size="sm"
                className="justify-start text-xs h-auto py-1"
                onClick={() => handleSuggestionClick("Summarize this lecture")}
              >
                {t("📝 Summarize this lecture", "📝 ملخص المحاضرة")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start text-xs h-auto py-1"
                onClick={() => handleSuggestionClick("Explain the key medical terms")}
              >
                {t("📚 Explain the key medical terms", "📚 اشرح المصطلحات المهمة")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start text-xs h-auto py-1"
                onClick={() => handleSuggestionClick("Create one source-based review question")}
              >
                {t("❓ Create a review question", "❓ أسئلة امتحان محتملة")}
              </Button>
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div
                dir="auto"
                className={`max-w-[85%] rounded-xl px-4 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "self-end bg-primary text-primary-foreground"
                    : "self-start bg-muted"
                }`}
              >
                {m.content}
              </div>

              {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                <div className="self-start flex items-center gap-1 text-xs text-muted-foreground">
                  <BookOpen className="h-3 w-3" />
                  {m.sources.map((s, j) => (
                    <span key={j}>{s.lectureTitle}{j < m.sources!.length - 1 ? " · " : ""}</span>
                  ))}
                </div>
              )}

              {m.role === "assistant" && m.rating !== undefined && !busy && (
                <div className="self-start flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => regenerate(i)}
                    title={t("Regenerate", "إعادة توليد")}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-6 w-6 ${m.rating === "up" ? "text-emerald-500" : ""}`}
                    onClick={() => rate(i, "up")}
                  >
                    <ThumbsUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-6 w-6 ${m.rating === "down" ? "text-red-500" : ""}`}
                    onClick={() => rate(i, "down")}
                  >
                    <ThumbsDown className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}

        {streaming ? (
          <div className="max-w-[85%] self-start rounded-xl bg-muted px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap">
            {streaming}
            <span className="animate-pulse">▍</span>
          </div>
        ) : busy ? (
          <div className="self-start rounded-xl bg-muted px-4 py-2 text-sm text-muted-foreground">
            {t("Thinking…", "جارٍ التفكير…")}
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-600">{error}</p>
      ) : null}

      {!limitReached ? (
        <div className="mt-4 flex gap-2">
          <input
            aria-label={t("Ask VYLO about this lecture", "اسأل VYLO عن هذه المحاضرة")}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("Ask about this lecture… (Shift+Enter for a new line)", "اكتب سؤالك هنا… (Shift+Enter لسطر جديد)")}
            disabled={busy}
          />
          <Button className="min-h-11" onClick={() => send()} disabled={busy || !input.trim()}>
            {t("Send", "إرسال")}
          </Button>
        </div>
      ) : null}
   </div>
  );
}
