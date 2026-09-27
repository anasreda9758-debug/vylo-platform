import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import { streamTutorReply, type TutorMessage } from "@/shared/ai-client";
import { FREE_DAILY_LIMIT, getAiUsageToday, recordAiUsage } from "@/features/ai/queries";
import { hasAnySubscription } from "@/features/billing/queries";
import { getRAGIndex, retrieve } from "@/features/rag";
import { tutorChatSchema } from "@/shared/validation";
import { updateStreak } from "@/features/gamification/queries";
import { createSourceTutorReply } from "@/features/review/source-generators";
import { getAccessibleLecture } from "@/features/access/learning-access";
import { safeUpdateStreak } from "@/features/gamification/error-handling";

// ── Principle 1: Role Playing ──────────────────────────────────────────────
function buildSystemPrompt(
  title: string,
  moduleName: string,
  relevantChunks: { text: string; lectureTitle: string; moduleSlug: string }[],
  fallbackContent: string | null,
) {
  const context = relevantChunks.length > 0
    ? relevantChunks
        .map((c, i) => `--- مصدر ${i + 1}: ${c.lectureTitle} (${c.moduleSlug}) ---\n${c.text}`)
        .join("\n\n")
    : fallbackContent
      ? fallbackContent.slice(0, 8000)
      : "(لا يوجد محتوى نصي متاح)";

  // ── Principles 2+3+4: Boundaries + Formatting + Constraints ──
  return `# الدور والشخصية
أنت "د. هوروس" — أستاذ طب جامعي خبير في تخصص "${moduleName}".
أنت تدرّس في كلية طب مصرية. تتحدث بالعربية الفصحى العلمية فقط.
أسلوبك: أكاديمي دقيق، مباشر، بدون حشو أو كلام عام.
لا تستخدم ألفاظ عامية أو دعابات. لا تقول "أهلاً" أو "مرحباً" — ابدأ فوراً بالمحتوى.

# الحدود الصارمة (Context Boundaries)
أنت مقيّد بالمحتوى المُقدم أدناه بشكل مطلق.
- استخرج الإجابات فقط من المراجع والمحتوى المُقدم.
- إذا كانت المعلومة غير موجودة في المحتوى المُقدم، قل جملة واحدة:
  "هذه المعلومة غير متوفرة في محتوى المحاضرة الحالية. يُنصح بمراجعة المصادر الأكاديمية."
- لا تختلق أو تُخترع معلومات طبية أبداً.
- لا تعطي نصائح علاجية محددة — قل "استشر طبيبك".
- إذا كان السؤال خارج نطاق المحاضرة تماماً، قل:
  "هذا السؤال خارج نطاق المحاضرة الحالية (${title}). يُرجى السؤال داخل سياق المحتوى."

# شكل المخرجات حسب نوع السؤال

## إذا كان السؤال طلباً للشرح:
أعد الإجابة بهذا الترتيب بالضبط:
**الشرح:**
[شرح مبسط ومنظم بالفقرات]

**أهم النقاط للحفظ:**
- نقطة 1
- نقطة 2
- نقطة 3

**المصطلحات المهمة:**
- المصطلح الإنجليزي = التعريف بالعربية

**سؤال متوقع في الامتحان:**
[سؤال MCQ بسيط مع الإجابة الصحيحة]

## إذا كان السؤال يطلب اختباراً أو أسئلة:
أعد JSON صالح فقط بهذا الشكل بدون أي كلام خارج JSON:
\`\`\`json
{"questions":[{"q":"نص السؤال","options":["أ","ب","ج","د"],"correct":"أ","explanation":"سبب الصواب"}]}
\`\`\`

## إذا كان السؤال يطلب خريطة ذهنية:
أعد كود Mermaid صالح فقط بدون أي كلام خارج الكود:
\`\`\`mermaid
mindmap
  root((العنوان))
    فرع1
      عنصر1
      عنصر2
    فرع2
      عنصر3
\`\`\`
استخدم حروف إنجليزية للعقد وأضف النص العربي داخل أقواس مربعة.

## إذا كان السؤال عاماً أو توضيحياً:
أعد فقرة واحدة مرتّبة تحتوي:
1. تعريف مختصر
2. الشرح العلمي
3. صلة المحاضرة

# قواعد الجودة
- لا تكرر السؤال في الإجابة — ابدأ مباشرة بالجواب.
- إذا ذكرت إحصائية، اذكر مصدرها من المحتوى المُقدم.
- إذا وجدت تضارباً في المصادر، اذكر الرأيين واذكر أن هناك خلافاً أكاديمياً.
- الإجابة القصيرة المختصرة أفضل من الطويلة المملّة.

# المحتوى العلمي المُقدم
المحاضرة: ${title}
الموديول: ${moduleName}

=== مراجع ذات صلة (استخرج منها الإجابة) ===
${context}`;
}

// ── Detect query type for response guidance ──
function detectQueryType(msg: string): string {
  const lower = msg.toLowerCase();
  if (/اختبار|امتحان|MCQ|mcq|سئ(le|ؤ)ل|اختبرني|حل.?لي/.test(lower)) return "quiz";
  if (/خريطة ذهنية|mind.?map|مخطط/.test(lower)) return "mindmap";
  if (/اشرح|شرح|وضّح|فسّر|what is|define|volume/.test(lower)) return "explanation";
  return "general";
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let lectureId: string;
  let messages: TutorMessage[];
  try {
    const body = await request.json();
    const parsed = tutorChatSchema.parse(body);
    lectureId = parsed.lectureId;
    messages = parsed.messages;
  } catch (e: any) {
    if (e?.issues) {
      return NextResponse.json({ error: "validation", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const lectureAccess = await getAccessibleLecture(session.user, lectureId, { allowPreview: true });
  if (!lectureAccess.ok) return NextResponse.json({ error: "lecture not found" }, { status: 404 });
  const lectureRow = lectureAccess.value;
  await safeUpdateStreak(
    () => updateStreak(session.user.id),
    (msg: string, err?: Error) => console.warn(`[tutor] ${msg}`, err),
  );
  // Local source-grounded study tools are the default. A hosted model is an
  // explicit opt-in, never an accidental dependency just because a key exists.
  const useHostedModel = process.env.USE_HOSTED_AI === "true" && Boolean(process.env.GROQ_API_KEY);
  const premium = useHostedModel && await hasAnySubscription(session.user.id);
  if (useHostedModel && !premium) {
    const usedToday = await getAiUsageToday(session.user.id);
    if (usedToday >= FREE_DAILY_LIMIT) {
      return NextResponse.json(
        {
          error: "free_limit",
          message: `وصلت إلى حد ${FREE_DAILY_LIMIT} رسالة مجانية اليوم. فعّل Premium لفتح محادثات غير محدودة.`,
        },
        { status: 429 },
      );
    }
  }

  try {
    const lastUserMsg = messages[messages.length - 1].content;
    // The study assistant remains useful without a paid/hosted model. This
    // fallback only reorganizes the verified lecture text already in the DB.
    if (!useHostedModel) {
      const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
      const answer = createSourceTutorReply(
        lectureRow.title,
        lectureRow.content ?? "",
        lectureRow.summaryJson,
        lastUserMsg,
        { history },
      );
      return new Response(answer, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Sources": JSON.stringify([{
            lectureTitle: lectureRow.title,
            moduleSlug: lectureRow.module.slug,
          }]),
        },
      });
    }
    const queryType = detectQueryType(lastUserMsg);

    const ragIndex = await getRAGIndex();
    const retrieved = retrieve(ragIndex, lastUserMsg, {
      topK: 6,
      moduleSlug: lectureRow.module.slug,
    });

    const chunks = retrieved.map((r) => ({
      text: r.chunk.text,
      lectureTitle: r.chunk.lectureTitle,
      moduleSlug: r.chunk.moduleSlug,
    }));

    const systemPrompt = buildSystemPrompt(
      lectureRow.title,
      lectureRow.module.name,
      chunks,
      lectureRow.content,
    );

    // Add query-type hint to the last user message
    const typeHints: Record<string, string> = {
      quiz: "\n[نوع الطلب: اختبار MCQ — أعد JSON فقط كما هو محدد في التعليمات]",
      mindmap: "\n[نوع الطلب: خريطة ذهنية — أعد كود Mermaid فقط كما هو محدد]",
      explanation: "\n[نوع الطلب: شرح — التزم بالترتيب المحدد: شرح + نقاط + مصطلحات + سؤال]",
      general: "",
    };

    const patchedMessages = [...messages];
    patchedMessages[patchedMessages.length - 1] = {
      ...patchedMessages[patchedMessages.length - 1],
      content: patchedMessages[patchedMessages.length - 1].content + (typeHints[queryType] ?? ""),
    };

    // Stream the response
    const result = await streamTutorReply({
      system: systemPrompt,
      messages: patchedMessages,
    });

    await recordAiUsage({
      userId: session.user.id,
      lectureId,
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      inputTokens: 0,
      outputTokens: 0,
    });

    // Return sources alongside the stream
    const sources = chunks.map((c) => ({
      lectureTitle: c.lectureTitle,
      moduleSlug: c.moduleSlug,
    }));

    const response = result.toTextStreamResponse();
    // Append sources as a custom header (client will read from the response)
    response.headers.set("X-Sources", JSON.stringify(sources));
    return response;
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.message?.includes("timeout")) {
      return NextResponse.json({ error: "timeout", message: "انتهت مهلة الرد. حاول سؤالاً أقصر." }, { status: 504 });
    }
    console.error("tutor error:", err);
    return NextResponse.json({ error: "ai_unavailable" }, { status: 502 });
  }
}
