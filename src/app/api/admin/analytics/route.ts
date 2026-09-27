import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/shared/session";
import {
  getOverview,
  getUsers,
  getUserDetail,
  getSubscriptionTable,
  getPlansAdmin,
  getExpiringSubscriptionsWindow,
  getCurriculumHealth,
  getModuleHealth,
  getLectureHealth,
  getLearningSeries,
  getQuizAnalytics,
  getPracticalAnalytics,
  getOspeAnalytics,
  getReviewAnalytics,
  getAiAnalytics,
  getXpAnalytics,
  getActivityFeed,
  getPaymentsAdmin,
  getAuditRows,
  getAuditSummary,
  getSystemHealth,
  getAttentionWarnings,
  toCsv,
  csvFilename,
  parseRangeKey,
  resolveRange,
  parseUserSort,
  type RangeKey,
  type AttentionWarning,
} from "@/features/admin/analytics";

export const dynamic = "force-dynamic";

/**
 * Hard ceiling for any admin analytics request. Guarantees the client always
 * receives a response (data, partial data, or an explicit timeout error)
 * instead of spinning forever on a stuck DB call or a runaway query.
 * Read per-call so tests can shorten it.
 */
function requestTimeoutMs(): number {
  const raw = Number(process.env.ADMIN_ANALYTICS_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15000;
}

const VALID_ROLE = new Set(["student", "admin"]);

class AnalyticsTimeoutError extends Error {
  constructor(label: string) {
    super(`admin analytics timed out: ${label}`);
    this.name = "AnalyticsTimeoutError";
  }
}

/**
 * Races `work` against a hard deadline. A stuck DB call or an unbounded query
 * must never leave the admin UI spinning: the caller always settles, either
 * with the real result or with an explicit timeout error (HTTP 504).
 */
async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ms = requestTimeoutMs();
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AnalyticsTimeoutError(label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function csvDownload(payload: Record<string, unknown>[], filename: string) {
  return new NextResponse(toCsv(payload), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "overview";
  const rangeKey = parseRangeKey(url.searchParams.get("range"));
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const wantCsv = url.searchParams.get("csv") === "1";

  const page = Number(url.searchParams.get("page")) || 1;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  const search = url.searchParams.get("search");
  const role = url.searchParams.get("role");
  const statusParam = url.searchParams.get("status");
  const term = url.searchParams.get("term");
  const studyYear = url.searchParams.get("studyYear");
  const sortRaw = url.searchParams.get("sort");
  const dirRaw = url.searchParams.get("dir");

  if (role && !VALID_ROLE.has(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }

  const range = await withTimeout(
    resolveRange(rangeKey as RangeKey, {
      from: rangeKey === "custom" ? from : null,
      to: rangeKey === "custom" ? to : null,
    }),
    "resolveRange",
  );

  try {
    return await withTimeout(
      (async () => {
    switch (view) {
      case "overview": {
        const data = await getOverview(range);
        return NextResponse.json(data);
      }
      case "warnings": {
        const warnings = await getAttentionWarnings(range);
        return NextResponse.json({ warnings: warnings as AttentionWarning[], range: range.label });
      }
      case "users": {
        const data = await getUsers({
          search,
          role: role ?? null,
          studyYear: studyYear ?? null,
          sort: parseUserSort(sortRaw),
          dir: dirRaw === "asc" ? "asc" : dirRaw === "desc" ? "desc" : undefined,
          page,
          limit,
          range,
        });
        if (wantCsv) {
          return csvDownload(
            data.users.map((u) => ({
              name: u.name,
              email: u.email,
              role: u.role,
              study_year: u.studyYear || "",
              total_xp: u.totalXp,
              level: u.level,
              streak: u.streak,
              lectures_done: u.lecturesDone,
              quizzes_done: u.quizzesDone,
              practical_answers: u.practicalAnswers,
              flashcards: u.flashcards,
              cases: u.cases,
              ospe_exams: u.ospeExams,
              ai_used_today: u.aiToday,
              subscription: u.subStatus ?? "",
              plan: u.planName ?? "",
              last_active: u.lastActive ? new Date(u.lastActive).toISOString() : "",
              created_at: new Date(u.createdAt).toISOString(),
            })),
            csvFilename("users"),
          );
        }
        return NextResponse.json(data);
      }
      case "user": {
        const id = url.searchParams.get("id");
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const data = await getUserDetail(id, range);
        if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
        return NextResponse.json(data);
      }
      case "subscriptions": {
        const [table, plans] = await Promise.all([getSubscriptionTable({ status: statusParam ?? null, search, page, limit }), getPlansAdmin()]);
        if (wantCsv) {
          return csvDownload(
            table.subscriptions.map((s) => ({
              user: s.userName,
              email: s.userEmail,
              status: s.status,
              plan: s.planName ?? "",
              scope: s.planScope ?? "",
              price_eg: s.priceEg ?? "",
              starts_at: new Date(s.startsAt).toISOString(),
              expires_at: new Date(s.expiresAt).toISOString(),
            })),
            csvFilename("subscriptions"),
          );
        }
        return NextResponse.json({ ...table, plans });
      }
      case "plans": {
        const plans = await getPlansAdmin();
        return NextResponse.json({ plans });
      }
      case "expiring": {
        const days = Number(url.searchParams.get("days")) || 7;
        const list = await getExpiringSubscriptionsWindow(days);
        return NextResponse.json({ days, list });
      }
      case "content": {
        const [curriculum, modules, lectures, expiring] = await Promise.all([
          getCurriculumHealth(),
          getModuleHealth({ search, term, studyYear }),
          getLectureHealth({ search, term, studyYear, page, limit, sort: sortRaw === "content" ? "content" : sortRaw === "progress" ? "progress" : "title", dir: dirRaw === "asc" ? "asc" : dirRaw === "desc" ? "desc" : undefined }),
          getExpiringSubscriptionsWindow(7),
        ]);
        if (wantCsv) {
          return csvDownload(
            lectures.lectures.map((l) => ({
              title: l.title,
              module: l.moduleName,
              study_year: l.studyYear,
              term: l.term,
              has_content: l.hasContent ? "yes" : "no",
              has_pdf: l.hasPdf ? "yes" : "no",
              has_summary: l.hasSummary ? "yes" : "no",
              has_mindmap: l.hasMindmap ? "yes" : "no",
              progress_events: l.progressEvents,
            })),
            csvFilename("lectures"),
          );
        }
        return NextResponse.json({ curriculum, modules, lectures, expiring });
      }
      case "learning": {
        const series = await getLearningSeries(range);
        return NextResponse.json({ ...series, range: range.label });
      }
      case "quiz": {
        const data = await getQuizAnalytics(range);
        return NextResponse.json({ ...data, range: range.label });
      }
      case "practical": {
        const data = await getPracticalAnalytics(range);
        return NextResponse.json({ ...data, range: range.label });
      }
      case "ospe": {
        const data = await getOspeAnalytics(range);
        return NextResponse.json({ ...data, range: range.label });
      }
      case "review": {
        const data = await getReviewAnalytics(range);
        return NextResponse.json({ ...data, range: range.label });
      }
      case "ai": {
        const data = await getAiAnalytics(range);
        return NextResponse.json({ ...data, range: range.label });
      }
      case "xp": {
        const data = await getXpAnalytics(range);
        return NextResponse.json({ ...data, range: range.label });
      }
      case "activity": {
        const data = await getActivityFeed({ range, limit });
        return NextResponse.json({ ...data, range: range.label });
      }
      case "payments": {
        const data = await getPaymentsAdmin(range);
        return NextResponse.json({ ...data, range: range.label });
      }
      case "audit": {
        const [rows, summary, activityRange] = await Promise.all([
          getAuditRows({
            action: statusParam ?? null,
            entityType: url.searchParams.get("entityType") ?? null,
            search,
            range,
            page,
            limit: limitRaw,
          }),
          getAuditSummary(),
          getActivityFeed({ range, limit: 5 }),
        ]);
        if (wantCsv) {
          return csvDownload(
            rows.logs.map((l) => ({
              user: l.userName ?? l.userId,
              action: l.action,
              entity_type: l.entityType,
              entity_name: l.entityName,
              created_at: new Date(l.createdAt).toISOString(),
            })),
            csvFilename("audit"),
          );
        }
        return NextResponse.json({ ...rows, summary, recent: activityRange.events, range: range.label });
      }
      case "system": {
        const data = await getSystemHealth();
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: "unknown view" }, { status: 400 });
    }
      })(),
      view,
    );
  } catch (error) {
    const timedOut = error instanceof AnalyticsTimeoutError;
    if (!timedOut) console.error("[admin/analytics]", error);
    return NextResponse.json(
      {
        error: timedOut ? "analytics_timeout" : "analytics_failed",
        view,
        range: range.label,
        ...(timedOut ? { message: `تجاوز الاستعلام الحد الأقصى للزمن (${requestTimeoutMs()}ms)` } : {}),
      },
      { status: timedOut ? 504 : 500 },
    );
  }
}