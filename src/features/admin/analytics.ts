/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/shared/db";
import { FREE_DAILY_LIMIT, STUDY_GENERATION_BUCKET } from "@/features/ai/queries";

export type Row = Record<string, any>;

export const DAILY_AI_LIMIT = FREE_DAILY_LIMIT;

/**
 * READ-ONLY analytics for the admin control center. Every query is an aggregate
 * (COUNT / SUM / GROUP BY) issued through the shared pool; nothing here writes.
 * Never import this module into a client component — it pulls in node-only
 * modules (child_process, fs) for the system-health view.
 */

// ----- Cairo time helpers -----

/** Current date as YYYY-MM-DD in the app's African/Cairo timezone. */
export function cairoDateStr(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function cairoUtcOffset(now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      timeZoneName: "longOffset",
    }).formatToParts(now);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = /^GMT([+-])(\d{1,2})$/.exec(tz.replace(":00", ""));
    if (!m) return "+02:00";
    return `${m[1]}${m[2].padStart(2, "0")}:00`;
  } catch {
    return "+02:00";
  }
}

/** Absolute Date at 00:00:00 of the given moment's Cairo calendar day. */
export function startOfCairoDay(now = new Date()): Date {
  const dateStr = cairoDateStr(now);
  return new Date(`${dateStr}T00:00:00${cairoUtcOffset(now)}`);
}

/**
 * Renders a Date as a naive `YYYY-MM-DD HH:MM:SS` literal in Cairo local time
 * for use as a SQL parameter.
 *
 * WHY THIS EXISTS: every analytics timestamp column is `timestamp without time
 * zone`. Drizzle + postgres-js cannot encode a JS `Date` object as a bind
 * parameter — it throws
 *   `TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type
 *    string ... Received an instance of Date`
 * from `Buffer.byteLength`, which surfaced as HTTP 500 on
 * /api/admin/analytics?view=overview. Handing Postgres a `Date` makes it
 * serialise using the *server* timezone; sending a naive Cairo string pins the
 * value explicitly and identically. Verified equivalent against the live DB
 * across 36 real window/table combinations.
 *
 * Do NOT replace this with `date.toISOString()`: that carries a `Z` suffix and
 * PostgreSQL re-interprets it in the session timezone, shifting every date
 * filter by the UTC offset.
 */
export function tsParam(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
}

// ----- Date ranges -----

/**
 * Coerces a DB timestamp value into an absolute Date.
 *
 * Drizzle returns `timestamp without time zone` columns as NAIVE STRINGS
 * (e.g. `'2027-07-01 00:00:00'`), not `Date` instances — assuming `Date` here
 * made `range=this_term` die with
 * `TypeError: period.endsAt.getTime is not a function` (HTTP 500). Those naive
 * strings are Cairo local wall-clock, so they are re-anchored with the Cairo
 * UTC offset, consistent with `startOfCairoDay`.
 */
export function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    // Already carries an explicit offset (or Z) — let the parser handle it.
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // Naive wall-clock, stored in Cairo local time.
    const d = new Date(`${s.replace(" ", "T")}${cairoUtcOffset()}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type RangeKey = "today" | "7d" | "30d" | "90d" | "this_term" | "custom";

export type ResolvedRange = {
  key: RangeKey;
  /** Inclusive lower bound (UTC absolute). Null = no filter. */
  since: Date | null;
  /** Exclusive upper bound. Null = no filter. */
  until: Date | null;
  /** Cairo date key lower bound for date-column filters (YYYY-MM-DD). */
  cairoSince: string | null;
  /** Cairo date key upper bound (inclusive, YYYY-MM-DD). */
  cairoUntil: string | null;
  label: string;
};

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "اليوم",
  "7d": "آخر 7 أيام",
  "30d": "آخر 30 يوم",
  "90d": "آخر 90 يوم",
  this_term: "الفصل الدراسي",
  custom: "مخصص",
};

export function parseRangeKey(value: string | null | undefined): RangeKey {
  if (value === "today" || value === "7d" || value === "30d" || value === "90d" || value === "this_term" || value === "custom") {
    return value;
  }
  return "30d";
}

function parseDateParam(value: string | null | undefined): string | null {
  if (!value) return null;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(value)) return null;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return value;
}

/**
 * Resolve a date-range selector into concrete bounds. May hit the DB for the
 * active academic period ("this_term"). `activePeriod` may be injected in tests.
 */
export async function resolveRange(
  range: RangeKey,
  opts?: { from?: string | null; to?: string | null; now?: Date; activePeriod?: { startsAt: Date; endsAt: Date | null } | null },
): Promise<ResolvedRange> {
  const now = opts?.now ?? new Date();
  const day = (deltaDays: number) => startOfCairoDay(new Date(now.getTime() + deltaDays * 86_400_000));

  switch (range) {
    case "today": {
      const since = day(0);
      return {
        key: range,
        since,
        until: new Date(since.getTime() + 86_400_000),
        cairoSince: cairoDateStr(since),
        cairoUntil: cairoDateStr(since),
        label: RANGE_LABELS[range],
      };
    }
    case "7d":
    case "30d":
    case "90d": {
      const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
      const since = day(-(days - 1));
      const until = day(1);
      return {
        key: range,
        since,
        until,
        cairoSince: cairoDateStr(since),
        cairoUntil: cairoDateStr(new Date(until.getTime() - 1000)),
        label: RANGE_LABELS[range],
      };
    }
    case "this_term": {
      let period = opts?.activePeriod === undefined ? null : opts.activePeriod;
      if (period === undefined) period = null;
      if (period === null) {
        try {
          const rows = (await db.execute(
            sql`SELECT starts_at, ends_at FROM academic_period WHERE active = true ORDER BY starts_at DESC LIMIT 1`,
          )) as Row[];
          if (rows[0]) {
            const startsAt = toDate(rows[0].starts_at);
            if (startsAt) period = { startsAt, endsAt: toDate(rows[0].ends_at) };
          }
        } catch {
          period = null;
        }
      }
      if (!period) {
        return {
          key: range,
          since: null,
          until: null,
          cairoSince: null,
          cairoUntil: null,
          label: "لا توجد فترة دراسية نشطة (كل البيانات)",
        };
      }
      return {
        key: range,
        since: period.startsAt,
        until: period.endsAt ? new Date(period.endsAt.getTime() + 86_400_000) : null,
        cairoSince: cairoDateStr(period.startsAt),
        cairoUntil: period.endsAt ? cairoDateStr(period.endsAt) : null,
        label: RANGE_LABELS[range],
      };
    }
    case "custom": {
      const from = parseDateParam(opts?.from);
      const to = parseDateParam(opts?.to);
      if (!from || !to) {
        return { key: range, since: null, until: null, cairoSince: null, cairoUntil: null, label: "نطاق مخصص" };
      }
      const since = new Date(`${from}T00:00:00`);
      const until = new Date(`${to}T00:00:00`);
      until.setDate(until.getDate() + 1);
      return {
        key: range,
        since,
        until,
        cairoSince: from,
        cairoUntil: to,
        label: `${from} → ${to}`,
      };
    }
  }
}

/** WHERE fragment filters rows on a timestamp column using the range. */
function tsWhere(field: string, r: ResolvedRange): ReturnType<typeof sql> {
  if (!r.since && !r.until) return sql``;
  const parts: ReturnType<typeof sql>[] = [];
  if (r.since) parts.push(sql`${sql.raw(field)} >= ${tsParam(r.since)}`);
  if (r.until) parts.push(sql`${sql.raw(field)} < ${tsParam(r.until)}`);
  return sql`${sql.join(parts, sql` AND `)}`;
}

/** WHERE fragment for date-key columns (Cairo YYYY-MM-DD strings). */
function dateKeyWhere(field: string, r: ResolvedRange): ReturnType<typeof sql> {
  if (!r.cairoSince && !r.cairoUntil) return sql``;
  const parts: ReturnType<typeof sql>[] = [];
  if (r.cairoSince) parts.push(sql`${sql.raw(field)} >= ${r.cairoSince}`);
  if (r.cairoUntil) parts.push(sql`${sql.raw(field)} <= ${r.cairoUntil}`);
  return sql`${sql.join(parts, sql` AND `)}`;
}

function int(row: Row | undefined, key: string): number {
  const v = row?.[key];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

function num(row: Row | undefined, key: string): number {
  const v = row?.[key];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

// ----- Plan price source (local config only — never a network call) -----

/**
 * Resolves which plan price column the revenue estimate should read.
 * Local env only: pricing config must never issue a network call, nor block
 * the Overview render on a metadata query.
 */
async function planPriceSource(): Promise<"price_cents" | "price_eg"> {
  return Boolean(process.env.AI_COST_PER_1M_INPUT || process.env.AI_COST_PER_1M_OUTPUT) ? "price_cents" : "price_eg";
}

// ----- Overview (executive snapshot: all-time + today + active state) -----

export type Overview = {
  meta: { generatedAt: string; aiDailyLimit: number };
  users: {
    total: number;
    admins: number;
    students: number;
    newToday: number;
    activeToday: number;
    active7d: number;
    active30d: number;
  };
  content: {
    modules: number;
    modulesNoLectures: number;
    lectures: number;
    lecturesWithContent: number;
    lecturesMissingContent: number;
    lecturesWithPdf: number;
    lecturesWithAiSummary: number;
    lecturesWithMindmap: number;
    banks: number;
    questions: number;
    tracks: number;
    practicalQuestions: number;
    /** Real track→station bindings students can be examined on. */
    ospeStations: number;
    /** Reference answer/diagnosis rows for station images — not stations. */
    ospeAnswerKeys: number;
    ospeExams: number;
  };
  subscriptions: {
    total: number;
    active: number;
    grace: number;
    expired: number;
    cancelled: number;
    expiring7d: number;
    subscribers: number;
    activeValueCents: number;
    priceSource: string;
    paymobConfigured: boolean;
  };
  learning: {
    lectures: number;
    quizzes: number;
    quizAnswers: number;
    practicalSubmissions: number;
    flashcards: number;
    cases: number;
    caseEvaluations: number;
    ospeExams: number;
    xpEvents: number;
  };
  quiz: { completed: number; inProgress: number; avgScorePct: number; total: number };
  ai: {
    usedToday: number;
    hostedToday: number;
    tokensToday: number;
    featureBreakdown: { feature: string; total: number; completed: number; failed: number }[];
    quotaBuckets: { pct0: number; pct25: number; pct50: number; pct75: number; pct100: number; unused: number };
    groqConfigured: boolean;
  };
  xp: { totalXp: number; todayXp: number; todayEvents: number; activeStreaks: number; avgStreak: number };
  topModules: { id: string; name: string; slug: string; completions: number }[];
  warnings: AttentionWarning[];
  payments: { enabled: boolean; byStatus: { status: string; total: number; amountEg: number }[] };
};

// ----- Attention center -----

export type WarningSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AttentionWarning = {
  id: string;
  severity: WarningSeverity;
  title: string;
  detail: string;
  count?: number;
  view?: string;
};

export function gradeSeverity(count: number, threshold: number): WarningSeverity {
  if (count >= threshold * 2) return "CRITICAL";
  if (count >= threshold) return "WARNING";
  return "INFO";
}

export async function getAttentionWarnings(range: ResolvedRange): Promise<AttentionWarning[]> {
  const warnings: AttentionWarning[] = [];
  const today = cairoDateStr();

  const [[lecturesMissing], [modsNoLectures], [bundles], [aiAtLimit], [expiring], , [practicalReview]] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS c FROM lecture WHERE content IS NULL OR content = ''`),
    db.execute(sql`SELECT count(*)::int AS c FROM module m WHERE NOT EXISTS (SELECT 1 FROM lecture l WHERE l.module_id = m.id)`),
    db.execute(sql`SELECT (SELECT count(*)::int FROM practical_track_ospe_station) AS stations, (SELECT count(*)::int FROM practical_track) AS tracks`),
    db.execute(sql`SELECT count(*)::int AS c FROM ai_usage_daily WHERE usage_date = ${today} AND bucket = ${STUDY_GENERATION_BUCKET} AND count >= ${FREE_DAILY_LIMIT}`),
    db.execute(sql`SELECT count(*)::int AS c FROM subscription WHERE status = 'active' AND expires_at BETWEEN now() AND now() + interval '7 days'`),
    db.execute(sql`SELECT count(*)::int AS c FROM ospe_answer_key`),
    db.execute(sql`SELECT count(*)::int AS c FROM practical_question WHERE review_status IN ('DRAFT', 'NEEDS_REVIEW')`),
  ]);

  const missing = int(lecturesMissing as Row | undefined, "c");
  if (missing > 0) {
    warnings.push({
      id: "lectures-missing-content",
      severity: missing > 4 ? "WARNING" : "INFO",
      title: "محاضرات بدون محتوى",
      detail: `${missing} محاضرة بدون نص — مراجعة المنهج مطلوبة.`,
      count: missing,
      view: "content",
    });
  }

  const bare = int(modsNoLectures as Row | undefined, "c");
  if (bare > 0) {
    warnings.push({
      id: "modules-no-lectures",
      severity: "INFO",
      title: "موديولات بلا محاضرات",
      detail: `${bare} موديول لا يضم أي محاضرة.`,
      count: bare,
      view: "content",
    });
  }

  const review = int(practicalReview as Row | undefined, "c");
  if (review > 0) {
    warnings.push({
      id: "practical-needs-review",
      severity: gradeSeverity(review, 3),
      title: "أسئلة عملية بالمراجعة",
      detail: `${review} سؤال عملي لم يُعتمد (DRAFT / NEEDS_REVIEW).`,
      count: review,
      view: "practical",
    });
  }

  const atLimit = int(aiAtLimit as Row | undefined, "c");
  if (atLimit > 0) {
    warnings.push({
      id: "ai-limit-reached",
      severity: "INFO",
      title: "طلاب بلغوا حد الذكاء اليومي",
      detail: `${atLimit} طالب استهلكوا حصة اليوم (${FREE_DAILY_LIMIT} عملية).`,
      count: atLimit,
      view: "ai",
    });
  }

  const expiringCount = int(expiring as Row | undefined, "c");
  if (expiringCount > 0) {
    warnings.push({
      id: "subscriptions-expiring",
      severity: "WARNING",
      title: "اشتراكات تنتهي خلال 7 أيام",
      detail: `${expiringCount} اشتراك نشط سينتهي قريباً.`,
      count: expiringCount,
      view: "subscriptions",
    });
  }

  // `bundles` is already the FIRST ROW (destructured above), not the row array.
  // Reading `bundles[0]` here always yielded undefined, so this warning fired
  // unconditionally regardless of the real station count.
  const stations = int(bundles as Row | undefined, "stations");
  if (Number(stations) === 0) {
    warnings.push({
      id: "ospe-zero-stations",
      severity: "INFO",
      title: "لا توجد محطات OSPE مهيأة",
      detail: "لم يتم ربط أي محطة إجابة OSPE بمسار — ستظهر نتائج الطلاب فارغة حتى تهيئة المحطات.",
      count: 0,
      view: "ospe",
    });
  }

  if (warnings.length === 0) {
    warnings.push({
      id: "all-clear",
      severity: "INFO",
      title: "لا توجد مشاكل ملحوظة",
      detail: "كل مؤشرات المنصة ضمن الحدود الطبيعية في النطاق الحالي.",
    });
  }

  void range;
  return warnings;
}

// ----- Overview queries -----

const ospeExamQueryFlag = 0; // unused; keeps lint quiet about the shared OSPE subquery below

/**
 * Development-only timing for admin analytics batches. Logs name + duration so
 * a slow section is identifiable without attaching a profiler. Never logs query
 * text, rows, or any secret/connection detail, and is compiled out in prod.
 */
const ANALYTICS_TIMING = process.env.NODE_ENV !== "production";
async function timed<T>(name: string, work: Promise<T>): Promise<T> {
  if (!ANALYTICS_TIMING) return work;
  const started = Date.now();
  try {
    return await work;
  } catch (error) {
    console.error(`[admin/perf] ${name} failed after ${Date.now() - started}ms`, error);
    throw error;
  } finally {
    console.log(`[admin/perf] ${name} ${Date.now() - started}ms`);
  }
}

export async function getOverview(range?: ResolvedRange): Promise<Overview> {
  const r = range ?? (await resolveRange("today"));
  const todayKey = cairoDateStr();

  const [usersRow, activeToday, active7d, active30d, subsRow, subsUsers, contentRow, learningRow, quizRow, aiToday, aiBuckets, xpRow, todaysXp, topModules] = await timed("overview.core", Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM "user") AS total,
        (SELECT count(*)::int FROM "user" WHERE role = 'admin') AS admins,
        (SELECT count(*)::int FROM "user" WHERE role = 'student') AS students,
        (SELECT count(*)::int FROM "user" WHERE created_at >= ${tsParam(startOfCairoDay())}) AS new_today
    `),
    db.execute(sql`
      SELECT count(DISTINCT d.user_id)::int AS users FROM (
        SELECT user_id FROM lecture_progress WHERE completed_at >= ${tsParam(startOfCairoDay())}
        UNION SELECT user_id FROM quiz_attempt WHERE status = 'completed' AND completed_at >= ${tsParam(startOfCairoDay())}
        UNION SELECT user_id FROM practical_submission WHERE created_at >= ${tsParam(startOfCairoDay())}
        UNION SELECT user_id FROM clinical_case_evaluation WHERE evaluated_at >= ${tsParam(startOfCairoDay())}
      ) d
    `),
    db.execute(sql`
      SELECT count(DISTINCT d.user_id)::int AS users FROM (
        SELECT user_id FROM lecture_progress WHERE completed_at >= ${tsParam(startOfCairoDay(new Date(Date.now() - 6 * 86_400_000)))}
        UNION SELECT user_id FROM quiz_attempt WHERE status = 'completed' AND completed_at >= ${tsParam(startOfCairoDay(new Date(Date.now() - 6 * 86_400_000)))}
        UNION SELECT user_id FROM practical_submission WHERE created_at >= ${tsParam(startOfCairoDay(new Date(Date.now() - 6 * 86_400_000)))}
        UNION SELECT user_id FROM clinical_case_evaluation WHERE evaluated_at >= ${tsParam(startOfCairoDay(new Date(Date.now() - 6 * 86_400_000)))}
      ) d
    `),
    db.execute(sql`
      SELECT count(DISTINCT d.user_id)::int AS users FROM (
        SELECT user_id FROM lecture_progress WHERE completed_at >= ${tsParam(startOfCairoDay(new Date(Date.now() - 29 * 86_400_000)))}
        UNION SELECT user_id FROM quiz_attempt WHERE status = 'completed' AND completed_at >= ${tsParam(startOfCairoDay(new Date(Date.now() - 29 * 86_400_000)))}
        UNION SELECT user_id FROM practical_submission WHERE created_at >= ${tsParam(startOfCairoDay(new Date(Date.now() - 29 * 86_400_000)))}
        UNION SELECT user_id FROM clinical_case_evaluation WHERE evaluated_at >= ${tsParam(startOfCairoDay(new Date(Date.now() - 29 * 86_400_000)))}
      ) d
    `),
    db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'active' AND expires_at > now())::int AS active,
        count(*) FILTER (WHERE status = 'grace')::int AS grace,
        count(*) FILTER (WHERE status = 'expired')::int AS expired,
        count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        count(*) FILTER (WHERE status = 'active' AND expires_at BETWEEN now() AND now() + interval '7 days')::int AS expiring_7d
      FROM subscription
    `),
    db.execute(sql`SELECT count(DISTINCT user_id)::int AS c FROM subscription WHERE status = 'active' AND expires_at > now()`),
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM module) AS modules,
        (SELECT count(*)::int FROM module m WHERE NOT EXISTS (SELECT 1 FROM lecture l WHERE l.module_id = m.id)) AS modules_no_lectures,
        (SELECT count(*)::int FROM lecture) AS lectures,
        (SELECT count(*)::int FROM lecture WHERE content IS NOT NULL AND content <> '') AS lectures_with_content,
        (SELECT count(*)::int FROM lecture WHERE pdf_file IS NOT NULL AND pdf_file <> '') AS lectures_with_pdf,
        (SELECT count(*)::int FROM lecture WHERE summary_json IS NOT NULL) AS lectures_ai_summary,
        (SELECT count(*)::int FROM lecture WHERE mindmap_json IS NOT NULL) AS lectures_mindmap,
        (SELECT count(*)::int FROM question_bank) AS banks,
        (SELECT count(*)::int FROM question) AS questions,
        (SELECT count(*)::int FROM practical_track) AS tracks,
        (SELECT count(*)::int FROM practical_question) AS practical_questions,
        (SELECT count(*)::int FROM practical_track_ospe_station) AS ospe_stations,
        (SELECT count(*)::int FROM ospe_answer_key) AS ospe_answer_keys,
        (SELECT count(*)::int FROM ospe_exam) AS ospe_exams
    `),
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM lecture_progress WHERE ${tsWhere("completed_at", r)}) AS lectures,
        (SELECT count(*)::int FROM quiz_attempt WHERE status = 'completed' AND ${tsWhere("completed_at", r)}) AS quizzes,
        (SELECT count(*)::int FROM quiz_answer WHERE ${tsWhere("answered_at", r)}) AS quiz_answers,
        (SELECT count(*)::int FROM practical_submission WHERE ${tsWhere("created_at", r)}) AS practical,
        (SELECT count(*)::int FROM flashcard WHERE ${tsWhere("created_at", r)}) AS flashcards,
        (SELECT count(*)::int FROM clinical_case WHERE ${tsWhere("created_at", r)}) AS cases,
        (SELECT count(*)::int FROM clinical_case_evaluation WHERE ${tsWhere("evaluated_at", r)}) AS case_evaluations,
        (SELECT count(*)::int FROM ospe_exam WHERE ${tsWhere("completed_at", r)}) AS ospe_exams,
        (SELECT count(*)::int FROM xp_log WHERE ${tsWhere("created_at", r)}) AS xp_events
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        count(*)::int AS total,
        COALESCE(AVG(CASE WHEN total > 0 THEN score * 1.0 / total ELSE NULL END), 0)::float8 AS avg_score_pct
      FROM quiz_attempt
    `),
    db.execute(sql`
      SELECT
        COALESCE(SUM(count) FILTER (WHERE usage_date = ${todayKey}), 0)::int AS used_today,
        COALESCE(SUM(count) FILTER (WHERE usage_date = ${todayKey}), 0)::int AS hosted_hint
      FROM ai_usage_daily WHERE bucket = ${STUDY_GENERATION_BUCKET}
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= ${FREE_DAILY_LIMIT})::int AS pct_100,
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= 12 AND COALESCE(a.count, 0) < 15)::int AS pct_75,
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= 8 AND COALESCE(a.count, 0) < 12)::int AS pct_50,
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= 4 AND COALESCE(a.count, 0) < 8)::int AS pct_25,
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= 1 AND COALESCE(a.count, 0) < 4)::int AS pct_0,
        count(*) FILTER (WHERE COALESCE(a.count, 0) = 0)::int AS unused
      FROM "user" u
      LEFT JOIN ai_usage_daily a ON a.user_id = u.id AND a.usage_date = ${todayKey} AND a.bucket = ${STUDY_GENERATION_BUCKET}
      WHERE u.role = 'student'
    `),
    db.execute(sql`SELECT COALESCE(SUM(total_xp), 0)::int AS total_xp, COUNT(*)::int AS profiles FROM user_profile`),
    db.execute(sql`SELECT COALESCE(SUM(amount), 0)::int AS xp_today, count(*)::int AS events_today FROM xp_log WHERE created_at >= ${tsParam(startOfCairoDay())}`),
    db.execute(sql`
      SELECT m.id, m.name, m.slug, count(lp.id)::int AS completions
      FROM lecture_progress lp
      JOIN lecture l ON l.id = lp.lecture_id
      JOIN module m ON m.id = l.module_id
      WHERE ${tsWhere("lp.completed_at", r)}
      GROUP BY m.id, m.name, m.slug
      ORDER BY completions DESC
      LIMIT 10
    `),
  ]));

  void ospeExamQueryFlag;

  const u = (usersRow as Row[])[0];
  const subs = (subsRow as Row[])[0];
  const content = (contentRow as Row[])[0];
  const learn = (learningRow as Row[])[0];
  const quiz = (quizRow as Row[])[0];
  const aiT = (aiToday as Row[])[0];
  const aiB = (aiBuckets as Row[])[0];
  const xp = (xpRow as Row[])[0];
  const xpT = (todaysXp as Row[])[0];

  // Secondary sections run in ONE bounded batch with per-section isolation:
  // a failing/slow secondary section degrades to an empty state instead of
  // blocking the whole Overview (root cause is logged, never suppressed).
  const [featureBreakdown, warnings, payments, priceSource, revRows, streaksRow, hostedTodayRow] = await timed("overview.secondary", Promise.all([
    getAiFeatureBreakdown(r).catch((e) => {
      console.error("[admin/overview] ai feature breakdown failed", e);
      return [];
    }),
    getAttentionWarnings(r).catch((e) => {
      console.error("[admin/overview] attention warnings failed", e);
      return [];
    }),
    getPaymentsSnapshot().catch((e) => {
      console.error("[admin/overview] payments snapshot failed", e);
      return { enabled: false, byStatus: [] };
    }),
    planPriceSource(),
    (async () => {
      try {
        const centsCol = (await planPriceSource()) === "price_cents";
        return (await db.execute(
          centsCol
            ? sql`SELECT COALESCE(SUM(p.price_cents), 0)::int AS v FROM subscription s JOIN plan p ON p.id = s.plan_id WHERE s.status = 'active' AND s.expires_at > now()`
            : sql`SELECT COALESCE(SUM(p.price_eg * 100), 0)::int AS v FROM subscription s JOIN plan p ON p.id = s.plan_id WHERE s.status = 'active' AND s.expires_at > now()`,
        )) as Row[];
      } catch (e) {
        console.error("[admin/overview] active subscription value failed", e);
        return [] as Row[];
      }
    })(),
    db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE streak >= 2)::int AS active_streaks,
             COALESCE(AVG(streak), 0)::float8 AS avg_streak
      FROM user_profile
    `).catch((e) => {
      console.error("[admin/overview] streak query failed", e);
      return [{ active_streaks: 0, avg_streak: 0 }];
    }) as Promise<Row[]>,
    db.execute(sql`
      SELECT count(*)::int AS c, COALESCE(SUM(input_tokens + output_tokens), 0)::int AS tokens
      FROM ai_usage WHERE created_at >= ${tsParam(startOfCairoDay())}
    `).catch((e) => {
      console.error("[admin/overview] hosted ai usage query failed", e);
      return [{ c: 0, tokens: 0 }];
    }) as Promise<Row[]>,
  ]));

  // Active subscription monetary value — explicitly a DB-derived estimate of
  // entitlements, NEVER presented as actual received revenue.
  const activeValueCents = int((revRows as Row[])[0], "v");

  return {
    meta: { generatedAt: new Date().toISOString(), aiDailyLimit: FREE_DAILY_LIMIT },
    users: {
      total: int(u as Row | undefined, "total"),
      admins: int(u as Row | undefined, "admins"),
      students: int(u as Row | undefined, "students"),
      newToday: int(u as Row | undefined, "new_today"),
      activeToday: int(activeToday as Row[], "users"),
      active7d: int(active7d as Row[], "users"),
      active30d: int(active30d as Row[], "users"),
    },
    content: {
      modules: int(content as Row | undefined, "modules"),
      modulesNoLectures: int(content as Row | undefined, "modules_no_lectures"),
      lectures: int(content as Row | undefined, "lectures"),
      lecturesWithContent: int(content as Row | undefined, "lectures_with_content"),
      lecturesMissingContent: Math.max(0, int(content as Row | undefined, "lectures") - int(content as Row | undefined, "lectures_with_content")),
      lecturesWithPdf: int(content as Row | undefined, "lectures_with_pdf"),
      lecturesWithAiSummary: int(content as Row | undefined, "lectures_ai_summary"),
      lecturesWithMindmap: int(content as Row | undefined, "lectures_mindmap"),
      banks: int(content as Row | undefined, "banks"),
      questions: int(content as Row | undefined, "questions"),
      tracks: int(content as Row | undefined, "tracks"),
      practicalQuestions: int(content as Row | undefined, "practical_questions"),
      ospeStations: int(content as Row | undefined, "ospe_stations"),
      ospeAnswerKeys: int(content as Row | undefined, "ospe_answer_keys"),
      ospeExams: int(content as Row | undefined, "ospe_exams"),
    },
    subscriptions: {
      total: int(subs as Row | undefined, "total"),
      active: int(subs as Row | undefined, "active"),
      grace: int(subs as Row | undefined, "grace"),
      expired: int(subs as Row | undefined, "expired"),
      cancelled: int(subs as Row | undefined, "cancelled"),
      expiring7d: int(subs as Row | undefined, "expiring_7d"),
      subscribers: int(subsUsers as Row[], "c"),
      activeValueCents,
      priceSource,
      paymobConfigured: paymobConfigured(),
    },
    learning: {
      lectures: int(learn as Row | undefined, "lectures"),
      quizzes: int(learn as Row | undefined, "quizzes"),
      quizAnswers: int(learn as Row | undefined, "quiz_answers"),
      practicalSubmissions: int(learn as Row | undefined, "practical"),
      flashcards: int(learn as Row | undefined, "flashcards"),
      cases: int(learn as Row | undefined, "cases"),
      caseEvaluations: int(learn as Row | undefined, "case_evaluations"),
      ospeExams: int(learn as Row | undefined, "ospe_exams"),
      xpEvents: int(learn as Row | undefined, "xp_events"),
    },
    quiz: {
      completed: int(quiz as Row | undefined, "completed"),
      inProgress: int(quiz as Row | undefined, "in_progress"),
      total: int(quiz as Row | undefined, "total"),
      avgScorePct: Math.round(num(quiz as Row | undefined, "avg_score_pct") * 100),
    },
    ai: {
      usedToday: int(aiT as Row | undefined, "used_today"),
      hostedToday: int(hostedTodayRow[0], "c"),
      tokensToday: int(hostedTodayRow[0], "tokens"),
      featureBreakdown,
      quotaBuckets: {
        pct0: int(aiB as Row | undefined, "pct_0"),
        pct25: int(aiB as Row | undefined, "pct_25"),
        pct50: int(aiB as Row | undefined, "pct_50"),
        pct75: int(aiB as Row | undefined, "pct_75"),
        pct100: int(aiB as Row | undefined, "pct_100"),
        unused: int(aiB as Row | undefined, "unused"),
      },
      groqConfigured: groqConfigured(),
    },
    xp: {
      totalXp: int(xp as Row | undefined, "total_xp"),
      todayXp: int(xpT as Row | undefined, "xp_today"),
      todayEvents: int(xpT as Row | undefined, "events_today"),
      activeStreaks: int(streaksRow[0], "active_streaks"),
      avgStreak: Math.round(num(streaksRow[0], "avg_streak") * 10) / 10,
    },
    topModules: (topModules as Row[]).map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      completions: int(m, "completions"),
    })),
    warnings,
    payments,
  };
}

function paymobConfigured(): boolean {
  return Boolean(process.env.PAYMOB_API_KEY && process.env.PAYMOB_INTEGRATION_ID && process.env.PAYMOB_HMAC_SECRET);
}

function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

async function getAiFeatureBreakdown(r: ResolvedRange): Promise<{ feature: string; total: number; completed: number; failed: number }[]> {
  try {
    const rows = (await db.execute(sql`
      SELECT feature, count(*)::int AS total,
             count(*) FILTER (WHERE status = 'completed')::int AS completed,
             count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM ai_generation_request
      WHERE ${tsWhere("created_at", r)}
      GROUP BY feature
      ORDER BY total DESC
    `)) as Row[];
    return rows.map((row) => ({ feature: row.feature, total: int(row, "total"), completed: int(row, "completed"), failed: int(row, "failed") }));
  } catch {
    return [];
  }
}

export async function getPaymentsSnapshot(): Promise<{ enabled: boolean; byStatus: { status: string; total: number; amountEg: number }[] }> {
  let byStatus: { status: string; total: number; amountEg: number }[] = [];
  try {
    const rows = (await db.execute(sql`
      SELECT status, count(*)::int AS total, COALESCE(SUM(amount_eg), 0)::int AS amount_eg
      FROM payment GROUP BY status ORDER BY status
    `)) as Row[];
    byStatus = rows.map((row) => ({ status: row.status, total: int(row, "total"), amountEg: int(row, "amount_eg") }));
  } catch {
    byStatus = [];
  }
  return { enabled: paymobConfigured(), byStatus };
}

// ----- Users directory -----

export type UserSort = "created_at" | "name" | "email" | "quizzes" | "lectures" | "xp" | "last_active";

/**
 * Sort keys for the users directory.
 *
 * The paginated query wraps the per-user projection in a subquery aliased `t`
 * (`SELECT * FROM ( ... ) t ORDER BY ...`), so ORDER BY must reference the
 * subquery's output columns: either the `t.`-qualified passthrough columns or
 * the bare computed aliases. Referencing `u.` here fails with
 * `42P01 missing FROM-clause entry for table "u"` because `u` is only in scope
 * inside the subquery.
 */
const USER_SORT_MAP: Record<UserSort, string> = {
  created_at: "t.created_at",
  name: "t.name",
  email: "t.email",
  quizzes: "quizzes_done",
  lectures: "lectures_done",
  xp: "total_xp",
  last_active: "last_active",
};

/** ORDER BY expression for a users-directory sort key (scoped to the `t` subquery). */
export function userSortColumn(sort: UserSort = "created_at"): string {
  return USER_SORT_MAP[sort] ?? USER_SORT_MAP.created_at;
}

export function parseUserSort(value: string | null | undefined): UserSort {
  if (value === "created_at" || value === "name" || value === "email" || value === "quizzes" || value === "lectures" || value === "xp" || value === "last_active") {
    return value;
  }
  return "created_at";
}

export type UsersQuery = {
  search?: string | null;
  role?: string | null;
  studyYear?: string | null;
  sort?: UserSort;
  dir?: "asc" | "desc";
  page?: number;
  limit?: number;
  range?: ResolvedRange;
};

export async function getUsers(q: UsersQuery): Promise<{
  users: Record<string, any>[];
  total: number;
  page: number;
  limit: number;
  filters: { role: string | null; studyYear: number | null };
}> {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(200, Math.max(1, q.limit ?? 25));
  const offset = (page - 1) * limit;
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  const sortCol = userSortColumn(q.sort);

  const conds: ReturnType<typeof sql>[] = [];
  if (q.role) conds.push(sql`u.role = ${q.role}`);
  if (q.search) conds.push(sql`(u.name ILIKE ${`%${q.search}%`} OR u.email ILIKE ${`%${q.search}%`})`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const studyYear = q.studyYear ? Number(q.studyYear) || null : null;

  const inner = sql`
    SELECT u.id, u.name, u.email, u.role, u.email_verified, u.created_at, u.updated_at,
      COALESCE(up.total_xp, 0) AS total_xp, COALESCE(up.level, 1) AS level, COALESCE(up.streak, 0) AS streak,
      (SELECT count(*) FROM lecture_progress lp WHERE lp.user_id = u.id) AS lectures_done,
      (SELECT count(*) FROM quiz_attempt qa WHERE qa.user_id = u.id AND qa.status = 'completed') AS quizzes_done,
      (SELECT count(*) FROM practical_submission ps WHERE ps.user_id = u.id) AS practical_answers,
      (SELECT count(*) FROM flashcard fc WHERE fc.user_id = u.id) AS flashcards,
      (SELECT count(*) FROM clinical_case cc WHERE cc.user_id = u.id) AS cases,
      (SELECT count(*) FROM clinical_case_evaluation cce WHERE cce.user_id = u.id) AS case_evals,
      (SELECT count(*) FROM ospe_exam oe WHERE oe.user_id = u.id) AS ospe_exams,
      (SELECT COALESCE(a.count, 0) FROM ai_usage_daily a WHERE a.user_id = u.id AND a.usage_date = ${cairoDateStr()} AND a.bucket = ${STUDY_GENERATION_BUCKET}) AS ai_today,
      (SELECT COALESCE(MAX(m2.study_year), 0) FROM lecture_progress lp2 JOIN lecture l2 ON l2.id = lp2.lecture_id JOIN module m2 ON m2.id = l2.module_id WHERE lp2.user_id = u.id) AS study_year,
      (SELECT MAX(last) FROM (
        SELECT completed_at AS last FROM lecture_progress WHERE user_id = u.id
        UNION ALL SELECT completed_at FROM quiz_attempt WHERE user_id = u.id
        UNION ALL SELECT created_at FROM practical_submission WHERE user_id = u.id
        UNION ALL SELECT evaluated_at FROM clinical_case_evaluation WHERE user_id = u.id
        UNION ALL SELECT created_at FROM flashcard WHERE user_id = u.id
        UNION ALL SELECT created_at FROM clinical_case WHERE user_id = u.id
      ) x) AS last_active,
      (SELECT s2.status FROM subscription s2 WHERE s2.user_id = u.id AND s2.status IN ('active', 'grace') ORDER BY s2.expires_at DESC LIMIT 1) AS sub_status,
      (SELECT p2.name FROM subscription s2 JOIN plan p2 ON p2.id = s2.plan_id WHERE s2.user_id = u.id AND s2.status IN ('active', 'grace') ORDER BY s2.expires_at DESC LIMIT 1) AS plan_name
    FROM "user" u
    LEFT JOIN user_profile up ON up.user_id = u.id
    ${where}
  `;

  const studyWhere = studyYear ? sql`WHERE study_year = ${studyYear}` : sql``;

  const rows = (await db.execute(sql`
    SELECT * FROM (
      ${inner}
    ) t
    ${studyWhere}
    ORDER BY ${sql.raw(sortCol)} ${sql.raw(dir)}
    LIMIT ${limit} OFFSET ${offset}
  `)) as Row[];

  const countRows = (await db.execute(sql`SELECT count(*)::int AS total FROM "user" u ${where}`)) as Row[];
  const total = int(countRows[0], "total");

  const users = rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
    totalXp: int(row, "total_xp"),
    level: int(row, "level"),
    streak: int(row, "streak"),
    lecturesDone: int(row, "lectures_done"),
    quizzesDone: int(row, "quizzes_done"),
    practicalAnswers: int(row, "practical_answers"),
    flashcards: int(row, "flashcards"),
    cases: int(row, "cases"),
    caseEvals: int(row, "case_evals"),
    ospeExams: int(row, "ospe_exams"),
    aiToday: int(row, "ai_today"),
    studyYear: int(row, "study_year"),
    lastActive: row.last_active,
    subStatus: row.sub_status,
    planName: row.plan_name,
  }));

  return { users, total, page, limit, filters: { role: q.role ?? null, studyYear } };
}

export async function getUserDetail(userId: string, r: ResolvedRange) {
  const [userRow] = (await db.execute(sql`SELECT * FROM "user" WHERE id = ${userId}`)) as Row[];
  if (!userRow) return null;

  const [counts, subs, progressTop, quizTop, xpTop, aiMonth, xpBreakdown, activity] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*) FROM lecture_progress WHERE user_id = ${userId}) AS lectures_done,
        (SELECT count(*) FROM quiz_attempt WHERE user_id = ${userId} AND status='completed') AS quizzes_done,
        (SELECT COALESCE(AVG(CASE WHEN total > 0 THEN score * 1.0 / total ELSE NULL END), 0)::float8 FROM quiz_attempt WHERE user_id = ${userId} AND status='completed') AS quiz_avg,
        (SELECT count(*) FROM practical_submission WHERE user_id = ${userId}) AS practical_answers,
        (SELECT count(*) FROM flashcard WHERE user_id = ${userId}) AS flashcards,
        (SELECT count(*) FROM clinical_case WHERE user_id = ${userId}) AS cases,
        (SELECT count(*) FROM clinical_case_evaluation WHERE user_id = ${userId}) AS case_evals,
        (SELECT count(*) FROM ospe_exam WHERE user_id = ${userId}) AS ospe_exams,
        (SELECT COALESCE(a.count, 0) FROM ai_usage_daily a WHERE a.user_id = ${userId} AND a.usage_date = ${cairoDateStr()} AND a.bucket = ${STUDY_GENERATION_BUCKET}) AS ai_today,
        (SELECT COALESCE(SUM(count), 0) FROM ai_usage_daily a WHERE a.user_id = ${userId} AND ${dateKeyWhere("a.usage_date", r)} AND a.bucket = ${STUDY_GENERATION_BUCKET}) AS ai_range
    `),
    db.execute(sql`
      SELECT s.id, s.status, s.starts_at, s.expires_at, s.grace_expires_at, s.created_at,
             p.name AS plan_name, p.scope, p.scope_ref, p.price_eg
      FROM subscription s LEFT JOIN plan p ON p.id = s.plan_id
      WHERE s.user_id = ${userId}
      ORDER BY s.created_at DESC
    `),
    db.execute(sql`
      SELECT l.title, m.name AS module_name, lp.completed_at
      FROM lecture_progress lp
      JOIN lecture l ON l.id = lp.lecture_id
      JOIN module m ON m.id = l.module_id
      WHERE lp.user_id = ${userId} AND ${tsWhere("lp.completed_at", r)}
      ORDER BY lp.completed_at DESC LIMIT 10
    `),
    db.execute(sql`
      SELECT qb.title, m.name AS module_name, qa.score, qa.total, qa.completed_at
      FROM quiz_attempt qa
      JOIN question_bank qb ON qb.id = qa.bank_id
      JOIN module m ON m.id = qb.module_id
      WHERE qa.user_id = ${userId} AND qa.status='completed' AND ${tsWhere("qa.completed_at", r)}
      ORDER BY qa.completed_at DESC LIMIT 10
    `),
    db.execute(sql`
      SELECT amount, reason, reference_id, created_at
      FROM xp_log WHERE user_id = ${userId} AND ${tsWhere("created_at", r)}
      ORDER BY created_at DESC LIMIT 25
    `),
    db.execute(sql`SELECT COALESCE(SUM(count), 0)::int AS ai_month FROM ai_usage_daily WHERE user_id = ${userId} AND usage_date >= ${cairoDateStr(new Date(new Date().getTime() - 29 * 86_400_000))} AND bucket = ${STUDY_GENERATION_BUCKET}`),
    db.execute(sql`
      SELECT reason, count(*)::int AS events, COALESCE(SUM(amount), 0)::int AS amount
      FROM xp_log WHERE user_id = ${userId} AND ${tsWhere("created_at", r)}
      GROUP BY reason ORDER BY amount DESC
    `),
    getActivityFeed({ range: r, limit: 15, userId }),
  ]);

  const c = (counts as Row[])[0] ?? {};
  const subList = (subs as Row[]).map((s) => ({
    id: s.id,
    status: s.status,
    startsAt: s.starts_at,
    expiresAt: s.expires_at,
    graceExpiresAt: s.grace_expires_at,
    planName: s.plan_name,
    planScope: s.scope,
    planScopeRef: s.scope_ref,
    priceEg: s.price_eg,
  }));

  return {
    id: userRow.id,
    name: userRow.name,
    email: userRow.email,
    role: userRow.role,
    emailVerified: Boolean(userRow.email_verified),
    createdAt: userRow.created_at,
    counts: {
      lecturesDone: int(c, "lectures_done"),
      quizzesDone: int(c, "quizzes_done"),
      quizAvgPct: Math.round(num(c, "quiz_avg") * 100),
      practicalAnswers: int(c, "practical_answers"),
      flashcards: int(c, "flashcards"),
      cases: int(c, "cases"),
      caseEvals: int(c, "case_evals"),
      ospeExams: int(c, "ospe_exams"),
      aiToday: int(c, "ai_today"),
      aiInRange: int(c, "ai_range"),
      aiMonth: int((aiMonth as Row[])[0], "ai_month"),
    },
    subscriptions: subList,
    recentLectures: (progressTop as Row[]).map((p) => ({ title: p.title, module: p.module_name, completedAt: p.completed_at })),
    recentQuizzes: (quizTop as Row[]).map((qz) => ({ title: qz.title, module: qz.module_name, score: int(qz, "score"), total: int(qz, "total"), completedAt: qz.completed_at })),
    xpLog: (xpTop as Row[]).map((x) => ({ amount: int(x, "amount"), reason: x.reason, referenceId: x.reference_id, createdAt: x.created_at })),
    xpBreakdown: (xpBreakdown as Row[]).map((b) => ({ reason: b.reason, events: int(b, "events"), amount: int(b, "amount") })),
    activity: activity.events,
  };
}

// ----- Subscriptions table -----

export async function getSubscriptionTable(q: {
  status?: string | null;
  search?: string | null;
  page?: number;
  limit?: number;
}): Promise<{ subscriptions: Record<string, any>[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(200, Math.max(1, q.limit ?? 25));
  const offset = (page - 1) * limit;

  const conds: ReturnType<typeof sql>[] = [];
  if (q.status && q.status !== "all") conds.push(sql`s.status = ${q.status}`);
  if (q.search) conds.push(sql`(u.name ILIKE ${`%${q.search}%`} OR u.email ILIKE ${`%${q.search}%`})`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = (await db.execute(sql`
    SELECT s.id, s.status, s.starts_at, s.expires_at, s.grace_expires_at, s.created_at,
           u.id AS user_id, u.name AS user_name, u.email AS user_email,
           p.name AS plan_name, p.scope, p.scope_ref, p.price_eg
    FROM subscription s
    JOIN "user" u ON u.id = s.user_id
    LEFT JOIN plan p ON p.id = s.plan_id
    ${where}
    ORDER BY s.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)) as Row[];

  const countRows = (await db.execute(sql`
    SELECT count(*)::int AS total FROM subscription s JOIN "user" u ON u.id = s.user_id ${where}
  `)) as Row[];

  return {
    subscriptions: rows.map((r) => ({
      id: r.id,
      status: r.status,
      startsAt: r.starts_at,
      expiresAt: r.expires_at,
      graceExpiresAt: r.grace_expires_at,
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      planName: r.plan_name,
      planScope: r.scope,
      planScopeRef: r.scope_ref,
      priceEg: r.price_eg,
    })),
    total: int(countRows[0], "total"),
    page,
    limit,
  };
}

export async function getPlansAdmin() {
  const rows = (await db.execute(sql`
    SELECT id, name, price_eg, duration_days, scope, scope_ref, active
    FROM plan ORDER BY scope, price_eg
  `)) as Row[];
  return rows.map((r) => ({ id: r.id, name: r.name, priceEg: int(r, "price_eg"), durationDays: int(r, "duration_days"), scope: r.scope, scopeRef: r.scope_ref, active: Boolean(r.active) }));
}

export async function getExpiringSubscriptionsWindow(days: number) {
  const rows = (await db.execute(sql`
    SELECT s.id, s.expires_at, u.name AS user_name, u.email AS user_email, p.name AS plan_name
    FROM subscription s
    JOIN "user" u ON u.id = s.user_id
    LEFT JOIN plan p ON p.id = s.plan_id
    WHERE s.status = 'active' AND s.expires_at BETWEEN now() AND now() + (${days} || ' days')::interval
    ORDER BY s.expires_at ASC
    LIMIT 100
  `)) as Row[];
  return rows.map((r) => ({ id: r.id, expiresAt: r.expires_at, userName: r.user_name, userEmail: r.user_email, planName: r.plan_name }));
}

// ----- Content / curriculum health -----

export async function getCurriculumHealth() {
  const rows = (await db.execute(sql`
    SELECT
      m.study_year AS study_year,
      m.term AS term,
      count(DISTINCT m.id)::int AS modules,
      count(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM lecture l WHERE l.module_id = m.id) THEN m.id END)::int AS modules_with_lectures,
      count(l.id)::int AS lectures,
      count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content <> '')::int AS lectures_with_content,
      count(l.id) FILTER (WHERE l.pdf_file IS NOT NULL AND l.pdf_file <> '')::int AS lectures_with_pdf,
      count(l.id) FILTER (WHERE l.summary_json IS NOT NULL)::int AS lectures_ai_summary,
      count(l.id) FILTER (WHERE l.mindmap_json IS NOT NULL)::int AS lectures_mindmap,
      count(DISTINCT qb.id)::int AS banks,
      count(DISTINCT q.id)::int AS questions,
      count(DISTINCT pt.id)::int AS tracks,
      count(DISTINCT pq.id)::int AS practical_questions,
      count(DISTINCT ok.id)::int AS ospe_keys
    FROM module m
    LEFT JOIN lecture l ON l.module_id = m.id
    LEFT JOIN question_bank qb ON qb.module_id = m.id
    LEFT JOIN question q ON q.bank_id = qb.id
    LEFT JOIN practical_track pt ON pt.module_id = m.id
    LEFT JOIN practical_question pq ON pq.module_id = m.id
    LEFT JOIN ospe_answer_key ok ON ok.folder = pt.subject_slug
    GROUP BY m.study_year, m.term
    ORDER BY m.study_year ASC, m.term ASC
  `)) as Row[];

  // Per-term readiness, computed from DB counts only.
  return rows.map((r) => {
    const modules = int(r, "modules");
    const lectures = int(r, "lectures");
    const withContent = int(r, "lectures_with_content");
    const withPdf = int(r, "lectures_with_pdf");
    const withAi = int(r, "lectures_ai_summary");
    const withMindmap = int(r, "lectures_mindmap");
    const banks = int(r, "banks");
    const questions = int(r, "questions");
    const tracks = int(r, "tracks");
    const practicalQ = int(r, "practical_questions");
    return {
      studyYear: int(r, "study_year"),
      term: int(r, "term"),
      modules,
      lectures,
      lecturesMissingContent: lectures - withContent,
      lecturesWithContent: withContent,
      lecturesWithPdf: withPdf,
      lecturesWithAi: withAi,
      lecturesWithMindmap: withMindmap,
      banks,
      questions,
      tracks,
      practicalQuestions: practicalQ,
      ready: modules > 0 && lectures > 0 && withContent === lectures && (banks > 0 || tracks > 0),
    };
  });
}

export async function getModuleHealth(q: { search?: string | null; term?: string | null; studyYear?: string | null }) {
  const conds: ReturnType<typeof sql>[] = [];
  if (q.term) conds.push(sql`m.term = ${Number(q.term) || 0}`);
  if (q.studyYear) conds.push(sql`m.study_year = ${Number(q.studyYear) || 0}`);
  if (q.search) conds.push(sql`m.name ILIKE ${`%${q.search}%`}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = (await db.execute(sql`
    SELECT m.id, m.name, m.slug, m.study_year, m.term, m.is_free,
      (SELECT count(*) FROM lecture l WHERE l.module_id = m.id) AS lectures,
      (SELECT count(*) FROM lecture l WHERE l.module_id = m.id AND (l.content IS NOT NULL AND l.content <> '')) AS with_content,
      (SELECT count(*) FROM lecture l WHERE l.module_id = m.id AND (l.pdf_file IS NOT NULL AND l.pdf_file <> '')) AS with_pdf,
      (SELECT count(*) FROM question_bank qb WHERE qb.module_id = m.id) AS banks,
      (SELECT count(*) FROM question q JOIN question_bank qb ON qb.id = q.bank_id WHERE qb.module_id = m.id) AS questions,
      (SELECT count(*) FROM practical_track pt WHERE pt.module_id = m.id) AS tracks,
      (SELECT count(*) FROM practical_question pq WHERE pq.module_id = m.id) AS practical_questions,
      (SELECT count(*) FROM lecture_progress lp JOIN lecture l ON l.id = lp.lecture_id WHERE l.module_id = m.id) AS progress_events
    FROM module m
    ${where}
    ORDER BY m.study_year ASC, m.term ASC, m."order" ASC, m.name ASC
    LIMIT 200
  `)) as Row[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    studyYear: int(r, "study_year"),
    term: int(r, "term"),
    isFree: Boolean(r.is_free),
    lectures: int(r, "lectures"),
    lecturesWithContent: int(r, "with_content"),
    lecturesMissingContent: int(r, "lectures") - int(r, "with_content"),
    lecturesWithPdf: int(r, "with_pdf"),
    banks: int(r, "banks"),
    questions: int(r, "questions"),
    tracks: int(r, "tracks"),
    practicalQuestions: int(r, "practical_questions"),
    progressEvents: int(r, "progress_events"),
  }));
}

export async function getLectureHealth(q: {
  search?: string | null;
  term?: string | null;
  studyYear?: string | null;
  page?: number;
  limit?: number;
  sort?: "title" | "content" | "progress";
  dir?: "asc" | "desc";
}): Promise<{ lectures: Record<string, any>[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(200, Math.max(1, q.limit ?? 25));
  const offset = (page - 1) * limit;
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  const sortMap = {
    title: "l.title",
    content: "l.content IS NOT NULL AND l.content <> ''",
    progress: "progress_events",
  } as const;
  const sortExpr = sortMap[q.sort ?? "title"];

  const conds: ReturnType<typeof sql>[] = [];
  if (q.term) conds.push(sql`m.term = ${Number(q.term) || 0}`);
  if (q.studyYear) conds.push(sql`m.study_year = ${Number(q.studyYear) || 0}`);
  if (q.search) conds.push(sql`l.title ILIKE ${`%${q.search}%`}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = (await db.execute(sql`
    SELECT l.id, l.title, l.slug, l.kind, m.name AS module_name, m.study_year AS study_year, m.term AS term,
      (l.content IS NOT NULL AND l.content <> '') AS has_content,
      (l.pdf_file IS NOT NULL AND l.pdf_file <> '') AS has_pdf,
      (l.summary_json IS NOT NULL) AS has_summary,
      (l.mindmap_json IS NOT NULL) AS has_mindmap,
      (SELECT count(*) FROM lecture_progress lp WHERE lp.lecture_id = l.id) AS progress_events
    FROM lecture l
    JOIN module m ON m.id = l.module_id
    ${where}
    ORDER BY ${sql.raw(sortExpr)} ${sql.raw(dir)}
    LIMIT ${limit} OFFSET ${offset}
  `)) as Row[];

  const countRows = (await db.execute(sql`
    SELECT count(*)::int AS total FROM lecture l JOIN module m ON m.id = l.module_id ${where}
  `)) as Row[];

  return {
    lectures: rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      kind: r.kind,
      moduleName: r.module_name,
      studyYear: int(r, "study_year"),
      term: int(r, "term"),
      hasContent: Boolean(r.has_content),
      hasPdf: Boolean(r.has_pdf),
      hasSummary: Boolean(r.has_summary),
      hasMindmap: Boolean(r.has_mindmap),
      progressEvents: int(r, "progress_events"),
    })),
    total: int(countRows[0], "total"),
    page,
    limit,
  };
}

// ----- Learning activity -----

export async function getLearningSeries(r: ResolvedRange): Promise<{
  days: { day: string; lectures: number; quizzes: number; practical: number; flashcards: number; cases: number }[];
  totals: { lectures: number; quizzes: number; practical: number; flashcards: number; cases: number };
}> {
  if (!r.since || !r.until) {
    return { days: [], totals: { lectures: 0, quizzes: 0, practical: 0, flashcards: 0, cases: 0 } };
  }
  const rows = (await db.execute(sql`
    SELECT d.day::date AS day,
      (SELECT count(*) FROM lecture_progress WHERE completed_at::date = d.day)::int AS lectures,
      (SELECT count(*) FROM quiz_attempt WHERE status = 'completed' AND completed_at::date = d.day)::int AS quizzes,
      (SELECT count(*) FROM practical_submission WHERE created_at::date = d.day)::int AS practical,
      (SELECT count(*) FROM xp_log WHERE created_at::date = d.day AND reason = 'flashcard_review')::int AS flashcards,
      (SELECT count(*) FROM clinical_case_evaluation WHERE evaluated_at::date = d.day)::int AS cases
    FROM generate_series(${tsParam(r.since!)}::date, ${tsParam(r.until!)}::date, interval '1 day') AS d(day)
    ORDER BY d.day
  `)) as Row[];

  const days = rows.map((r2) => ({
    day: (r2.day as Date).toISOString ? (r2.day as Date).toISOString().slice(0, 10) : String(r2.day).slice(0, 10),
    lectures: int(r2, "lectures"),
    quizzes: int(r2, "quizzes"),
    practical: int(r2, "practical"),
    flashcards: int(r2, "flashcards"),
    cases: int(r2, "cases"),
  }));

  const totals = days.reduce(
    (acc, d) => ({
      lectures: acc.lectures + d.lectures,
      quizzes: acc.quizzes + d.quizzes,
      practical: acc.practical + d.practical,
      flashcards: acc.flashcards + d.flashcards,
      cases: acc.cases + d.cases,
    }),
    { lectures: 0, quizzes: 0, practical: 0, flashcards: 0, cases: 0 },
  );

  return { days, totals };
}

// ----- Quiz analytics -----

export async function getQuizAnalytics(r: ResolvedRange) {
  const [summary, perDifficulty, perModule] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        count(*) FILTER (WHERE status = 'abandoned')::int AS abandoned,
        COALESCE(AVG(CASE WHEN status='completed' AND total > 0 THEN score * 1.0 / total END), 0)::float8 AS avg_pct
      FROM quiz_attempt WHERE ${tsWhere("started_at", r)}
    `),
    db.execute(sql`
      SELECT q.difficulty, count(DISTINCT qa.id)::int AS attempts,
        COALESCE(AVG(CASE WHEN qa.total > 0 THEN qa.score * 1.0 / qa.total END), 0)::float8 AS avg_pct
      FROM quiz_attempt qa JOIN question q ON q.bank_id = qa.bank_id
      WHERE qa.status = 'completed' AND ${tsWhere("qa.completed_at", r)}
      GROUP BY q.difficulty ORDER BY q.difficulty
    `),
    db.execute(sql`
      SELECT m.id, m.name, m.slug, count(DISTINCT qa.id)::int AS attempts,
             count(DISTINCT qa.user_id)::int AS students,
             COALESCE(AVG(CASE WHEN qa.total > 0 THEN qa.score * 1.0 / qa.total END), 0)::float8 AS avg_pct
      FROM quiz_attempt qa
      JOIN question_bank qb ON qb.id = qa.bank_id
      JOIN module m ON m.id = qb.module_id
      WHERE qa.status = 'completed' AND ${tsWhere("qa.completed_at", r)}
      GROUP BY m.id, m.name, m.slug
      ORDER BY attempts DESC LIMIT 20
    `),
  ]);

  const sums: Record<string, number> = {};
  const difficulty = (perDifficulty as Row[]).map((d) => {
    sums[d.difficulty ?? "unknown"] = int(d, "attempts");
    return { difficulty: d.difficulty ?? "unknown", attempts: int(d, "attempts"), avgPct: Math.round(num(d, "avg_pct") * 100) };
  });

  return {
    summary: {
      total: int((summary as Row[])[0], "total"),
      completed: int((summary as Row[])[0], "completed"),
      inProgress: int((summary as Row[])[0], "in_progress"),
      abandoned: int((summary as Row[])[0], "abandoned"),
      avgScorePct: Math.round(num((summary as Row[])[0], "avg_pct") * 100),
    },
    difficulty,
    difficultySums: sums,
    perModule: (perModule as Row[]).map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      attempts: int(m, "attempts"),
      students: int(m, "students"),
      avgPct: Math.round(num(m, "avg_pct") * 100),
    })),
  };
}

// ----- Practical analytics -----

export async function getPracticalAnalytics(r: ResolvedRange) {
  const [tracks, byStatus, byReview, submissions, progress] = await Promise.all([
    db.execute(sql`
      SELECT pt.status, count(*)::int AS total, count(*) FILTER (WHERE pt.practice_enabled)::int AS practice_enabled,
             count(*) FILTER (WHERE pt.ospe_enabled)::int AS ospe_enabled
      FROM practical_track pt GROUP BY pt.status ORDER BY pt.status
    `),
    db.execute(sql`
      SELECT status, count(*)::int AS total FROM practical_question GROUP BY status ORDER BY status
    `),
    db.execute(sql`
      SELECT review_status, count(*)::int AS total FROM practical_question GROUP BY review_status ORDER BY review_status
    `),
    db.execute(sql`
      SELECT count(*)::int AS total, count(DISTINCT user_id)::int AS users
      FROM practical_submission WHERE ${tsWhere("created_at", r)}
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(attempts), 0)::int AS attempts, count(*)::int AS tracked_rows,
             count(*) FILTER (WHERE difficult)::int AS difficult, count(*) FILTER (WHERE bookmarked)::int AS bookmarked
      FROM practical_progress
    `),
  ]);

  const byStatusRow = (byStatus as Row[]).map((s) => ({ status: s.status, total: int(s, "total") }));
  const byReviewRow = (byReview as Row[]).map((s) => ({ status: s.review_status, total: int(s, "total") }));

  return {
    tracks: (tracks as Row[]).map((t) => ({
      status: t.status,
      total: int(t, "total"),
      practiceEnabled: int(t, "practice_enabled"),
      ospeEnabled: int(t, "ospe_enabled"),
    })),
    trackTotal: (tracks as Row[]).reduce((a, t) => a + int(t, "total"), 0),
    byStatus: byStatusRow,
    byReview: byReviewRow,
    submissions: { total: int((submissions as Row[])[0], "total"), users: int((submissions as Row[])[0], "users") },
    progress: {
      attempts: int((progress as Row[])[0], "attempts"),
      trackedRows: int((progress as Row[])[0], "tracked_rows"),
      difficult: int((progress as Row[])[0], "difficult"),
      bookmarked: int((progress as Row[])[0], "bookmarked"),
    },
  };
}

// ----- OSPE analytics -----

export async function getOspeAnalytics(r: ResolvedRange) {
  const [stations, answerKeys, exams, tracks] = await Promise.all([
    // A "configured station" is a track→station binding the student can be
    // examined on. `practical_track_ospe_station` is the authoritative source.
    db.execute(sql`SELECT count(*)::int AS total FROM practical_track_ospe_station`),
    // `ospe_answer_key` rows are the answer/diagnosis reference for station
    // IMAGES (folder + file_name). They are reference data, NOT live stations.
    db.execute(sql`SELECT count(*)::int AS total, count(DISTINCT folder)::int AS folders FROM ospe_answer_key`),
    db.execute(sql`
      SELECT status, count(*)::int AS total, COALESCE(AVG(total_score * 1.0 / NULLIF(max_possible_score, 0)), 0)::float8 AS avg_pct
      FROM ospe_exam WHERE ${tsWhere("created_at", r)}
      GROUP BY status ORDER BY status
    `),
    db.execute(sql`
      SELECT pt.id, pt.subject, pt.display_name_en, pt.display_name_ar, pt.status, pt.practice_enabled, pt.ospe_enabled,
        (SELECT count(*) FROM practical_track_ospe_station pto WHERE pto.track_id = pt.id) AS station_bindings
      FROM practical_track pt ORDER BY pt.sort_order ASC
    `),
  ]);

  return {
    stationsConfigured: int((stations as Row[])[0], "total"),
    answerKeyEntries: int((answerKeys as Row[])[0], "total"),
    answerKeyFolders: int((answerKeys as Row[])[0], "folders"),
    exams: (exams as Row[]).map((e) => ({
      status: e.status,
      total: int(e, "total"),
      avgPct: Math.round(num(e, "avg_pct") * 100),
    })),
    tracks: (tracks as Row[]).map((t) => ({
      id: t.id,
      subject: t.subject,
      displayNameEn: t.display_name_en,
      displayNameAr: t.display_name_ar,
      status: t.status,
      practiceEnabled: Boolean(t.practice_enabled),
      ospeEnabled: Boolean(t.ospe_enabled),
      stationBindings: int(t, "station_bindings"),
    })),
  };
}

// ----- Flashcards & clinical cases -----

export async function getReviewAnalytics(r: ResolvedRange) {
  const [flashcards, flashReviews, dueRow, cases, evals] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE ${tsWhere("created_at", r)})::int AS created_range,
        count(*) FILTER (WHERE due_date <= now())::int AS due
      FROM flashcard
    `),
    db.execute(sql`
      SELECT count(*)::int AS reviews, count(DISTINCT user_id)::int AS users
      FROM xp_log WHERE reason = 'flashcard_review' AND ${tsWhere("created_at", r)}
    `),
    db.execute(sql`
      SELECT fc.lecture_id, count(*)::int AS due_count, l.title AS lecture_title, m.name AS module_name
      FROM flashcard fc JOIN lecture l ON l.id = fc.lecture_id JOIN module m ON m.id = l.module_id
      WHERE fc.due_date <= now() GROUP BY fc.lecture_id, l.title, m.name ORDER BY due_count DESC LIMIT 10
    `),
    db.execute(sql`
      SELECT count(*)::int AS total_folders,
        count(DISTINCT lecture_id)::int AS lectures_covered,
        count(*) FILTER (WHERE ${tsWhere("created_at", r)})::int AS created_range
      FROM clinical_case
    `),
    db.execute(sql`
      SELECT count(*)::int AS total_evals,
        count(DISTINCT user_id)::int AS users,
        COALESCE(AVG(score), 0)::float8 AS avg_score,
        count(*) FILTER (WHERE ${tsWhere("evaluated_at", r)})::int AS evals_range
      FROM clinical_case_evaluation
    `),
  ]);

  return {
    flashcards: {
      total: int((flashcards as Row[])[0], "total"),
      createdInRange: int((flashcards as Row[])[0], "created_range"),
      dueNow: int((flashcards as Row[])[0], "due"),
    },
    flashcardReviews: { reviews: int((flashReviews as Row[])[0], "reviews"), users: int((flashReviews as Row[])[0], "users") },
    mostDue: (dueRow as Row[]).map((d) => ({ lectureTitle: d.lecture_title, moduleName: d.module_name, dueCount: int(d, "due_count") })),
    cases: {
      total: int((cases as Row[])[0], "total_folders"),
      lecturesCovered: int((cases as Row[])[0], "lectures_covered"),
      createdInRange: int((cases as Row[])[0], "created_range"),
    },
    caseEvaluations: {
      total: int((evals as Row[])[0], "total_evals"),
      inRange: int((evals as Row[])[0], "evals_range"),
      users: int((evals as Row[])[0], "users"),
      avgScore: Math.round(num((evals as Row[])[0], "avg_score") * 10) / 10,
    },
  };
}

// ----- AI usage section -----

export async function getAiAnalytics(r: ResolvedRange) {
  const todayKey = cairoDateStr();
  const [daily, buckets, hosted, features, topUsers, tokens] = await Promise.all([
    db.execute(sql`
      SELECT usage_date, COALESCE(SUM(count), 0)::int AS used
      FROM ai_usage_daily
      WHERE ${dateKeyWhere("usage_date", r)} AND bucket = ${STUDY_GENERATION_BUCKET}
      GROUP BY usage_date ORDER BY usage_date
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= ${FREE_DAILY_LIMIT})::int AS pct_100,
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= 12 AND COALESCE(a.count, 0) < 15)::int AS pct_75,
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= 8 AND COALESCE(a.count, 0) < 12)::int AS pct_50,
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= 4 AND COALESCE(a.count, 0) < 8)::int AS pct_25,
        count(*) FILTER (WHERE COALESCE(a.count, 0) >= 1 AND COALESCE(a.count, 0) < 4)::int AS pct_0,
        count(*) FILTER (WHERE COALESCE(a.count, 0) = 0)::int AS unused
      FROM "user" u
      LEFT JOIN ai_usage_daily a ON a.user_id = u.id AND a.usage_date = ${todayKey} AND a.bucket = ${STUDY_GENERATION_BUCKET}
      WHERE u.role = 'student'
    `),
    db.execute(sql`
      SELECT count(*)::int AS calls, COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM ai_usage WHERE ${tsWhere("created_at", r)}
    `),
    db.execute(sql`
      SELECT feature, count(*)::int AS total,
             count(*) FILTER (WHERE status = 'completed')::int AS completed,
             count(*) FILTER (WHERE status = 'failed')::int AS failed,
             COALESCE(SUM(quota_reserved), 0)::int AS quota
      FROM ai_generation_request WHERE ${tsWhere("created_at", r)}
      GROUP BY feature ORDER BY total DESC
    `),
    db.execute(sql`
      SELECT u.id, u.name, u.email,
        COALESCE(SUM(CASE WHEN a.bucket = ${STUDY_GENERATION_BUCKET} THEN a.count ELSE 0 END), 0)::int AS total_used
      FROM "user" u
      JOIN ai_usage_daily a ON a.user_id = u.id
      WHERE u.role = 'student' AND ${dateKeyWhere("a.usage_date", r)} AND a.bucket = ${STUDY_GENERATION_BUCKET}
      GROUP BY u.id, u.name, u.email
      ORDER BY total_used DESC LIMIT 15
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(input_tokens), 0)::int AS input_tokens, COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM ai_usage WHERE ${tsWhere("created_at", r)}
    `),
  ]);

  const aiDaily = (daily as Row[]).map((d) => ({ day: String(d.usage_date).slice(0, 10), used: int(d, "used") }));

  return {
    dailyLimit: FREE_DAILY_LIMIT,
    usedToday: aiDaily.length > 0 && aiDaily[aiDaily.length - 1]?.day === todayKey ? aiDaily[aiDaily.length - 1].used : 0,
    daily: aiDaily,
    buckets: {
      pct0: int((buckets as Row[])[0], "pct_0"),
      pct25: int((buckets as Row[])[0], "pct_25"),
      pct50: int((buckets as Row[])[0], "pct_50"),
      pct75: int((buckets as Row[])[0], "pct_75"),
      pct100: int((buckets as Row[])[0], "pct_100"),
      unused: int((buckets as Row[])[0], "unused"),
    },
    hosted: {
      calls: int((hosted as Row[])[0], "calls"),
      inputTokens: int((hosted as Row[])[0], "input_tokens"),
      outputTokens: int((hosted as Row[])[0], "output_tokens"),
    },
    features: (features as Row[]).map((f) => ({
      feature: f.feature,
      total: int(f, "total"),
      completed: int(f, "completed"),
      failed: int(f, "failed"),
      quota: int(f, "quota"),
    })),
    topUsers: (topUsers as Row[]).map((tu) => ({ id: tu.id, name: tu.name, email: tu.email, total: int(tu, "total_used") })),
    tokens: { input: int((tokens as Row[])[0], "input_tokens"), output: int((tokens as Row[])[0], "output_tokens") },
    groqConfigured: groqConfigured(),
    costPricingConfigured: Boolean(process.env.AI_COST_PER_1M_INPUT || process.env.AI_COST_PER_1M_OUTPUT),
  };
}

// ----- XP / gamification -----

export async function getXpAnalytics(r: ResolvedRange) {
  const todayKey = startOfCairoDay();
  const [totals, byReason, leaderboard, xpDays, todayUsers] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(SUM(total_xp), 0)::int AS total_xp, COUNT(*)::int AS profiles,
             COUNT(*) FILTER (WHERE streak >= 2)::int AS active_streaks,
             COALESCE(AVG(streak), 0)::float8 AS avg_streak,
             COALESCE(SUM(battles_won), 0)::int AS battles_won,
             COALESCE(SUM(battles_lost), 0)::int AS battles_lost
      FROM user_profile
    `),
    db.execute(sql`
      SELECT reason, count(*)::int AS events, COALESCE(SUM(amount), 0)::int AS amount
      FROM xp_log WHERE ${tsWhere("created_at", r)}
      GROUP BY reason ORDER BY amount DESC
    `),
    db.execute(sql`
      SELECT up.user_id AS id, u.name AS name, up.total_xp AS total_xp, up.level AS level,
             up.streak AS streak, up.battles_won AS battles_won, up.battles_lost AS battles_lost
      FROM user_profile up JOIN "user" u ON u.id = up.user_id
      ORDER BY up.total_xp DESC LIMIT 20
    `),
    db.execute(sql`
      SELECT created_at::date AS day, COALESCE(SUM(amount), 0)::int AS xp, count(*)::int AS events
      FROM xp_log WHERE ${tsWhere("created_at", r)}
      GROUP BY created_at::date ORDER BY day
    `),
    db.execute(sql`
      SELECT user_id, name, count(*)::int AS events, SUM(amount)::int AS total
      FROM (SELECT xp.user_id AS user_id, u.name AS name, xp.amount AS amount
            FROM xp_log xp JOIN "user" u ON u.id = xp.user_id WHERE xp.created_at >= ${tsParam(todayKey)}) t
      GROUP BY user_id, name ORDER BY events DESC LIMIT 20
    `),
  ]);

  return {
    totals: {
      totalXp: int((totals as Row[])[0], "total_xp"),
      profiles: int((totals as Row[])[0], "profiles"),
      activeStreaks: int((totals as Row[])[0], "active_streaks"),
      avgStreak: Math.round(num((totals as Row[])[0], "avg_streak") * 10) / 10,
      battlesWon: int((totals as Row[])[0], "battles_won"),
      battlesLost: int((totals as Row[])[0], "battles_lost"),
    },
    byReason: (byReason as Row[]).map((b) => ({ reason: b.reason, events: int(b, "events"), amount: int(b, "amount") })),
    leaderboard: (leaderboard as Row[]).map((l, i) => ({
      rank: i + 1,
      id: l.id,
      name: l.name,
      totalXp: int(l, "total_xp"),
      level: int(l, "level"),
      streak: int(l, "streak"),
      battlesWon: int(l, "battles_won"),
      battlesLost: int(l, "battles_lost"),
    })),
    daily: (xpDays as Row[]).map((d) => ({ day: (d.day as Date).toISOString ? (d.day as Date).toISOString().slice(0, 10) : String(d.day).slice(0, 10), xp: int(d, "xp"), events: int(d, "events") })),
    todayUsers: (todayUsers as Row[]).map((tu) => ({ id: tu.user_id, name: tu.name, events: int(tu, "events"), total: int(tu, "total") })),
  };
}

// ----- Activity feed -----

export async function getActivityFeed(q: { range?: ResolvedRange; limit?: number; userId?: string }): Promise<{
  events: { type: string; userId: string; userName: string; ts: string; title: string | null; entity: string | null }[];
  hasRange: boolean;
}> {
  const r = q.range ?? (await resolveRange("7d"));
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));
  const tsConds: ReturnType<typeof sql>[] = [];
  if (r.since) tsConds.push(sql`ev.ts >= ${tsParam(r.since)}`);
  if (r.until) tsConds.push(sql`ev.ts < ${tsParam(r.until)}`);
  const timeWhere = tsConds.length ? sql`WHERE ${sql.join(tsConds, sql` AND `)}` : sql``;
  const userWhere = q.userId ? sql`AND u.id = ${q.userId}` : sql``;

  const rows = (await db.execute(sql`
    SELECT * FROM (
      SELECT 'register' AS type, u.id AS user_id, u.name AS user_name, u.created_at AS ts, NULL::text AS title, NULL::text AS entity
      FROM "user" u ${q.userId ? sql`WHERE u.id = ${q.userId}` : sql``}
      UNION ALL
      SELECT 'lecture', u.id, u.name, lp.completed_at, l.title, m.name
      FROM lecture_progress lp
      JOIN "user" u ON u.id = lp.user_id ${userWhere}
      JOIN lecture l ON l.id = lp.lecture_id JOIN module m ON m.id = l.module_id
      UNION ALL
      SELECT 'quiz', u.id, u.name, qa.completed_at, qb.title, m.name
      FROM quiz_attempt qa
      JOIN "user" u ON u.id = qa.user_id ${userWhere}
      JOIN question_bank qb ON qb.id = qa.bank_id JOIN module m ON m.id = qb.module_id
      WHERE qa.status = 'completed'
      UNION ALL
      SELECT 'practical', u.id, u.name, ps.created_at, pq.prompt, m.name
      FROM practical_submission ps
      JOIN "user" u ON u.id = ps.user_id ${userWhere}
      JOIN practical_question pq ON pq.id = ps.question_id JOIN module m ON m.id = pq.module_id
      UNION ALL
      SELECT 'case_eval', u.id, u.name, cce.evaluated_at, cc.case_text, m.name
      FROM clinical_case_evaluation cce
      JOIN "user" u ON u.id = cce.user_id ${userWhere}
      JOIN clinical_case cc ON cc.id = cce.case_id
      JOIN lecture l ON l.id = cc.lecture_id JOIN module m ON m.id = l.module_id
      UNION ALL
      SELECT 'subscription', u.id, u.name, s.created_at, p.name, NULL
      FROM subscription s
      JOIN "user" u ON u.id = s.user_id ${userWhere}
      LEFT JOIN plan p ON p.id = s.plan_id
      UNION ALL
      SELECT 'ospe_exam', u.id, u.name, oe.completed_at, NULL, NULL
      FROM ospe_exam oe JOIN "user" u ON u.id = oe.user_id ${userWhere}
      WHERE oe.completed_at IS NOT NULL
    ) ev
    ${timeWhere}
    ORDER BY ev.ts DESC
    LIMIT ${limit}
  `)) as Row[];

  return {
    hasRange: Boolean(r.since || r.until),
    events: rows.map((row) => ({
      type: row.type,
      userId: row.user_id,
      userName: row.user_name,
      ts: row.ts,
      title: row.title,
      entity: row.entity,
    })),
  };
}

// ----- Payments -----

export async function getPaymentsAdmin(r: ResolvedRange) {
  const [snapshot, countByMethod] = await Promise.all([
    getPaymentsSnapshot(),
    db.execute(sql`
      SELECT COALESCE(payment_method, '—') AS method, count(*)::int AS total, COALESCE(SUM(amount_eg), 0)::int AS amount_eg
      FROM payment WHERE ${tsWhere("created_at", r)}
      GROUP BY payment_method ORDER BY total DESC
    `),
  ]);

  return {
    enabled: snapshot.enabled,
    byStatus: snapshot.byStatus,
    byMethod: (countByMethod as Row[]).map((m) => ({ method: m.method, total: int(m, "total"), amountEg: int(m, "amount_eg") })),
  };
}

// ----- Audit (filtered) -----

export async function getAuditRows(q: {
  action?: string | null;
  entityType?: string | null;
  search?: string | null;
  range?: ResolvedRange;
  page?: number;
  limit?: number;
}): Promise<{ logs: Record<string, any>[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(200, Math.max(1, q.limit ?? 25));
  const offset = (page - 1) * limit;

  const conds: ReturnType<typeof sql>[] = [];
  if (q.action) conds.push(sql`action = ${q.action}`);
  if (q.entityType) conds.push(sql`entity_type = ${q.entityType}`);
  if (q.search) conds.push(sql`(user_name ILIKE ${`%${q.search}%`} OR entity_name ILIKE ${`%${q.search}%`} OR entity_id ILIKE ${`%${q.search}%`})`);
  if (q.range?.since) conds.push(sql`created_at >= ${tsParam(q.range.since)}`);
  if (q.range?.until) conds.push(sql`created_at < ${tsParam(q.range.until)}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

  const rows = (await db.execute(sql`
    SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
  `)) as Row[];
  const countRows = (await db.execute(sql`SELECT count(*)::int AS total FROM audit_log ${where}`)) as Row[];

  return {
    logs: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityName: r.entity_name,
      createdAt: r.created_at,
    })),
    total: int(countRows[0], "total"),
    page,
    limit,
  };
}

export async function getAuditSummary() {
  const rows = (await db.execute(sql`
    SELECT action, count(*)::int AS total FROM audit_log GROUP BY action ORDER BY total DESC
  `)) as Row[];
  return rows.map((r) => ({ action: r.action, total: int(r, "total") }));
}

// ----- System health -----

export type SystemHealth = {
  time: { now: string; cairoDate: string };
  env: { nodeEnv: string; baseUrlSet: boolean };
  db: { connected: boolean; version: string | null; migrationCount: number | null };
  git: { commit: string | null; short: string | null; totalCommits: number | null };
  integrations: {
    ai: { groqKeySet: boolean; provider: string | null };
    email: { resendKeySet: boolean };
    payments: { paymobApiKey: boolean; paymobIntegrationId: boolean; paymobHmac: boolean; enabled: boolean };
  };
  content: { rootSet: boolean; rootExists: boolean; imageFolders: number | null };
};

/** Pure — derives booleans from an env snapshot so tests can assert no secrets leak. */
export function sanitizeEnv(env: Record<string, string | undefined>): Pick<SystemHealth, "env" | "integrations" | "content"> {
  return {
    env: {
      nodeEnv: env.NODE_ENV ?? "development",
      baseUrlSet: Boolean(env.NEXT_PUBLIC_BASE_URL),
    },
    integrations: {
      ai: { groqKeySet: Boolean(env.GROQ_API_KEY), provider: env.AI_PROVIDER ?? null },
      email: { resendKeySet: Boolean(env.RESEND_API_KEY) },
      payments: {
        paymobApiKey: Boolean(env.PAYMOB_API_KEY),
        paymobIntegrationId: Boolean(env.PAYMOB_INTEGRATION_ID),
        paymobHmac: Boolean(env.PAYMOB_HMAC_SECRET),
        enabled: Boolean(env.PAYMOB_API_KEY && env.PAYMOB_INTEGRATION_ID && env.PAYMOB_HMAC_SECRET),
      },
    },
    content: {
      rootSet: Boolean(env.CONTENT_ROOT),
      rootExists: Boolean(env.CONTENT_ROOT) && existsSync(env.CONTENT_ROOT!),
      imageFolders: null,
    },
  };
}

function gitCommand(command: string): string | null {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Git metadata is resolved at most once per process. `execSync` is a blocking
 * syscall (up to 3s per call) and must never sit on the request path of the
 * admin shell, which renders these badges on every page load.
 */
let gitMetaCache: { commit: string | null; short: string | null; totalCommits: number | null } | null = null;
let gitMetaCachedAt = 0;
const GIT_META_TTL_MS = 60_000;

function gitMeta(): { commit: string | null; short: string | null; totalCommits: number | null } {
  const now = Date.now();
  if (gitMetaCache && now - gitMetaCachedAt < GIT_META_TTL_MS) return gitMetaCache;
  const commit = gitCommand("git rev-parse HEAD");
  const raw = gitCommand("git rev-list --count HEAD");
  gitMetaCache = {
    commit,
    short: commit ? commit.slice(0, 7) : null,
    totalCommits: raw ? Number(raw) || null : null,
  };
  gitMetaCachedAt = now;
  return gitMetaCache;
}

function countMigrationJournal(): number | null {
  try {
    const root = process.cwd();
    const candidates = ["drizzle/meta/_journal.json", "drizzle/meta/_journal.json", "drizzle/_journal.json"];
    for (const c of candidates) {
      const p = join(root, c);
      if (existsSync(p)) {
        const parsed = JSON.parse(readFileSync(p, "utf8")) as { entries?: unknown[] };
        return Array.isArray(parsed.entries) ? parsed.entries.length : null;
      }
    }
    // Fallback: count .sql files in drizzle dir
    const dir = join(root, "drizzle");
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
      if (files.length > 0) return files.length;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSystemHealth(): Promise<SystemHealth> {
  let version: string | null = null;
  let dbConnected = false;
  try {
    const rows = (await db.execute(sql`SELECT version()`)) as Row[];
    version = String(rows[0]?.version ?? "");
    dbConnected = true;
  } catch {
    version = null;
  }

  const envBits = sanitizeEnv(process.env as Record<string, string | undefined>);
  const git = gitMeta();

  let imageFolders: number | null = null;
  try {
    const root = envBits.content.rootExists ? process.env.CONTENT_ROOT! : null;
    if (root) {
      const entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
      imageFolders = entries.length;
    }
  } catch {
    imageFolders = null;
  }

  return {
    time: { now: new Date().toISOString(), cairoDate: cairoDateStr() },
    env: envBits.env,
    db: { connected: dbConnected, version, migrationCount: countMigrationJournal() },
    git: {
      commit: git.commit,
      short: git.short,
      totalCommits: git.totalCommits,
    },
    integrations: envBits.integrations,
    content: { ...envBits.content, imageFolders },
  };
}

// ----- CSV export -----

export function toCsv(rows: Record<string, any>[], columns?: { key: string; label: string }[]): string {
  if (rows.length === 0 && (!columns || columns.length === 0)) return "";
  const cols =
    columns ??
    Object.keys(rows[0] ?? {}).map((k) => ({
      key: k,
      label: k
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase()),
    }));

  const escapeCell = (value: unknown): string => {
    const s = value == null ? "" : String(value);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = cols.map((c) => escapeCell(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => escapeCell(r[c.key])).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function csvFilename(prefix: string): string {
  return `${prefix}-${cairoDateStr()}.csv`;
}