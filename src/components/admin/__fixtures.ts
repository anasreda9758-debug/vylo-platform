// Fixtures shaped EXACTLY like the live /api/admin/analytics payloads, but
// with synthetic identifiers — no real user data is committed.
// Shapes were captured from the running app; keep them in sync when the
// analytics contract changes (a mismatch here is a broken admin tab).
import type {
  ActivityResponse,
  AiResponse,
  AuditResponse,
  ContentResponse,
  LearningSeries,
  OspeResponse,
  Overview,
  PaymentsResponse,
  PracticalResponse,
  QuizResponse,
  ReviewResponse,
  SubscriptionsResponse,
  SystemHealth,
  UsersResponse,
  XpResponse,
} from "./types";

const now = "2026-09-27T10:00:00.000Z";

export const overviewPayload: Overview = {
  meta: { generatedAt: now, aiDailyLimit: 15 },
  users: { total: 115, admins: 1, students: 114, newToday: 0, activeToday: 0, active7d: 3, active30d: 9 },
  content: {
    modules: 44, modulesNoLectures: 33, lectures: 394, lecturesWithContent: 248,
    lecturesMissingContent: 146, lecturesWithPdf: 248, lecturesWithAiSummary: 248,
    lecturesWithMindmap: 248, banks: 7, questions: 740, tracks: 1,
    practicalQuestions: 15,
    // 0 real configured stations; answer keys are reference data only.
    ospeStations: 0,
    ospeAnswerKeys: 759,
    ospeExams: 5,
  },
  subscriptions: {
    total: 30, active: 16, grace: 0, expired: 14, cancelled: 0, expiring7d: 1,
    subscribers: 12, activeValueCents: 482700, priceSource: "price_eg", paymobConfigured: false,
  },
  learning: {
    lectures: 1, quizzes: 0, quizAnswers: 9, practicalSubmissions: 2, flashcards: 24,
    cases: 1, caseEvaluations: 0, ospeExams: 0, xpEvents: 12,
  },
  quiz: { completed: 0, inProgress: 1, avgScorePct: 0, total: 1 },
  ai: {
    usedToday: 0, hostedToday: 0, tokensToday: 0, featureBreakdown: [],
    quotaBuckets: { pct0: 114, pct25: 0, pct50: 0, pct75: 0, pct100: 0, unused: 114 },
    groqConfigured: true,
  },
  xp: { totalXp: 88, todayXp: 0, todayEvents: 0, activeStreaks: 1, avgStreak: 1.2 },
  topModules: [{ id: "m1", name: "Module", slug: "module", completions: 1 }],
  warnings: [
    { id: "lectures-missing-content", severity: "WARNING", title: "t", detail: "d", count: 146, view: "content" },
    { id: "ospe-zero-stations", severity: "INFO", title: "t", detail: "d", count: 0, view: "ospe" },
  ],
  payments: { enabled: false, byStatus: [] },
};

export const usersPayload: UsersResponse = {
  users: [
    {
      id: "u1", name: "Student One", email: "s1@example.test", role: "student",
      createdAt: "2026-08-15 21:02:45.048", // naive `timestamp without time zone`
      totalXp: 120, level: 3, streak: 2, lecturesDone: 5, quizzesDone: 1,
      practicalAnswers: 2, flashcards: 10, cases: 1, caseEvals: 0, ospeExams: 0,
      aiToday: 0, studyYear: 1, lastActive: null, subStatus: "active", planName: "Year",
    },
  ],
  total: 115, page: 1, limit: 25,
  filters: { role: null, studyYear: null },
};

export const subscriptionsPayload: SubscriptionsResponse = {
  subscriptions: [
    {
      id: "s1", status: "active", startsAt: "2026-08-16 20:37:49.301",
      expiresAt: "2027-08-16 20:37:49.302", graceExpiresAt: null,
      userId: "u1", userName: "Student One", userEmail: "s1@example.test",
      planName: "Full year", planScope: "year", planScopeRef: null, priceEg: 2500,
    },
  ],
  total: 30, page: 1, limit: 25,
  plans: [{ id: "p1", name: "Full year", priceEg: 2500, durationDays: 365, scope: "year", scopeRef: null, active: true }],
};

export const contentPayload: ContentResponse = {
  curriculum: [
    { studyYear: 1, term: 1, modules: 5, lectures: 122, lecturesMissingContent: 0, lecturesWithContent: 122, lecturesWithPdf: 122, lecturesWithAi: 0, lecturesWithMindmap: 0, banks: 3, questions: 300, tracks: 1, practicalQuestions: 15, ready: true },
    { studyYear: 5, term: 10, modules: 5, lectures: 0, lecturesMissingContent: 0, lecturesWithContent: 0, lecturesWithPdf: 0, lecturesWithAi: 0, lecturesWithMindmap: 0, banks: 0, questions: 0, tracks: 0, practicalQuestions: 0, ready: false },
  ],
  modules: [
    { id: "m1", name: "Module", slug: "module", studyYear: 1, term: 1, isFree: false, lectures: 47, lecturesWithContent: 47, lecturesMissingContent: 0, lecturesWithPdf: 47, banks: 2, questions: 100, tracks: 1, practicalQuestions: 15, progressEvents: 5 },
  ],
  lectures: {
    lectures: [
      { id: "l1", title: "Lecture", kind: "lecture", moduleName: "Module", studyYear: 1, term: 1, hasContent: true, hasPdf: true, hasSummary: false, hasMindmap: false, progressEvents: 2 },
    ],
    total: 394, page: 1, limit: 25,
  },
  range: "آخر 30 يوم",
};

export const learningPayload: LearningSeries = {
  days: [{ day: "2026-09-26", lectures: 1, quizzes: 0, practical: 0, flashcards: 2, cases: 0 }],
  totals: { lectures: 1, quizzes: 0, practical: 0, flashcards: 2, cases: 0 },
  range: "آخر 30 يوم",
};

export const quizPayload: QuizResponse = {
  summary: { total: 1, completed: 0, inProgress: 1, abandoned: 0, avgScorePct: 0 },
  difficulty: [], perModule: [], range: "آخر 30 يوم",
};

export const practicalPayload: PracticalResponse = {
  tracks: [{ status: "DRAFT", total: 1, practiceEnabled: 1, ospeEnabled: 0 }],
  trackTotal: 1,
  byStatus: [{ status: "DRAFT_AI", total: 15 }],
  // Includes the new source-grounded review status from the OSPE pipeline.
  byReview: [{ status: "AUTO_VERIFIED_SOURCE", total: 4 }, { status: "DRAFT", total: 11 }],
  submissions: { total: 2, users: 1 },
  progress: { attempts: 3, trackedRows: 2, difficult: 0, bookmarked: 1 },
  range: "آخر 30 يوم",
};

export const ospePayload: OspeResponse = {
  stationsConfigured: 0,
  answerKeyEntries: 759,
  answerKeyFolders: 4,
  exams: [],
  tracks: [
    { id: "t1", subject: "Anatomy", displayNameEn: "Anatomy", displayNameAr: "تشريح", status: "DRAFT", practiceEnabled: true, ospeEnabled: false, stationBindings: 0 },
  ],
  range: "آخر 30 يوم",
};

export const reviewPayload: ReviewResponse = {
  flashcards: { total: 24, createdInRange: 0, dueNow: 24 },
  flashcardReviews: { reviews: 12, users: 1 },
  mostDue: [{ lectureTitle: "Lecture", moduleName: "Module", dueCount: 5 }],
  cases: { total: 1, lecturesCovered: 1, createdInRange: 0 },
  caseEvaluations: { total: 0, inRange: 0, users: 0, avgScore: 0 },
  range: "آخر 30 يوم",
};

export const aiPayload: AiResponse = {
  dailyLimit: 15, usedToday: 0, daily: [],
  buckets: { pct0: 114, pct25: 0, pct50: 0, pct75: 0, pct100: 0, unused: 114 },
  hosted: { calls: 0, inputTokens: 0, outputTokens: 0 },
  features: [], topUsers: [], tokens: { input: 0, output: 0 },
  groqConfigured: true, costPricingConfigured: false, range: "آخر 30 يوم",
};

export const xpPayload: XpResponse = {
  totals: { totalXp: 88, profiles: 5, activeStreaks: 1, avgStreak: 1.2, battlesWon: 0, battlesLost: 0 },
  byReason: [{ reason: "quiz_correct", events: 4, amount: 40 }],
  leaderboard: [{ rank: 1, id: "u1", name: "Student One", totalXp: 88, level: 2, streak: 1, battlesWon: 0, battlesLost: 0 }],
  daily: [{ day: "2026-09-14", xp: 88, events: 6 }],
  todayUsers: [], range: "آخر 30 يوم",
};

export const activityPayload: ActivityResponse = {
  events: [{ type: "lecture", userId: "u1", userName: "Student One", ts: "2026-09-14 13:07:44.757", title: "Lecture", entity: "Module" }],
  range: "آخر 30 يوم",
};

export const paymentsPayload: PaymentsResponse = {
  enabled: false, byStatus: [], byMethod: [], range: "آخر 30 يوم",
};

export const auditPayload: AuditResponse = {
  logs: [], total: 0, page: 1, limit: 25, summary: [],
  recent: [{ type: "lecture", userId: "u1", userName: "Student One", ts: "2026-09-14 13:07:44.757", title: "Lecture", entity: "Module" }],
  range: "آخر 30 يوم",
};

export const systemPayload: SystemHealth = {
  time: { now, cairoDate: "2026-09-27" },
  env: { nodeEnv: "development", baseUrlSet: false },
  db: { connected: true, version: "PostgreSQL 18.4", migrationCount: 23 },
  git: { commit: "abc123def4567890", short: "abc123d", totalCommits: 92 },
  integrations: {
    ai: { groqKeySet: true, provider: null },
    email: { resendKeySet: true },
    payments: { paymobApiKey: false, paymobIntegrationId: false, paymobHmac: false, enabled: false },
  },
  content: { rootSet: false, rootExists: false, imageFolders: null },
};

export const ALL_PAYLOADS: Record<string, unknown> = {
  overview: overviewPayload,
  users: usersPayload,
  subscriptions: subscriptionsPayload,
  content: contentPayload,
  learning: learningPayload,
  quiz: quizPayload,
  practical: practicalPayload,
  ospe: ospePayload,
  review: reviewPayload,
  ai: aiPayload,
  xp: xpPayload,
  activity: activityPayload,
  payments: paymentsPayload,
  audit: auditPayload,
  system: systemPayload,
};
