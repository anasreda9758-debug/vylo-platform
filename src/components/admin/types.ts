"use client";

export type WarningSeverity = "INFO" | "WARNING" | "CRITICAL";

export type AttentionWarning = {
  id: string;
  severity: WarningSeverity;
  title: string;
  detail: string;
  count?: number;
  view?: string;
};

export type Overview = {
  meta: { generatedAt: string; aiDailyLimit: number };
  users: { total: number; admins: number; students: number; newToday: number; activeToday: number; active7d: number; active30d: number };
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
    ospeStations: number;
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

export type UsersResponse = {
  users: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
    totalXp: number;
    level: number;
    streak: number;
    lecturesDone: number;
    quizzesDone: number;
    practicalAnswers: number;
    flashcards: number;
    cases: number;
    caseEvals: number;
    ospeExams: number;
    aiToday: number;
    studyYear: number;
    lastActive: string | null;
    subStatus: string | null;
    planName: string | null;
  }[];
  total: number;
  page: number;
  limit: number;
  filters: { role: string | null; studyYear: number | null };
};

export type SubscriptionRow = {
  id: string;
  status: string;
  startsAt: string;
  expiresAt: string;
  graceExpiresAt: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  planName: string | null;
  planScope: string | null;
  planScopeRef: string | null;
  priceEg: number | null;
};

export type SubscriptionsResponse = {
  subscriptions: SubscriptionRow[];
  plans: { id: string; name: string; priceEg: number; durationDays: number; scope: string; scopeRef: string | null; active: boolean }[];
  total: number;
  page: number;
  limit: number;
};

export type ContentResponse = {
  curriculum: {
    studyYear: number;
    term: number;
    modules: number;
    lectures: number;
    lecturesMissingContent: number;
    lecturesWithContent: number;
    lecturesWithPdf: number;
    lecturesWithAi: number;
    lecturesWithMindmap: number;
    banks: number;
    questions: number;
    tracks: number;
    practicalQuestions: number;
    ready: boolean;
  }[];
  modules: {
    id: string;
    name: string;
    slug: string;
    studyYear: number;
    term: number;
    isFree: boolean;
    lectures: number;
    lecturesWithContent: number;
    lecturesMissingContent: number;
    lecturesWithPdf: number;
    banks: number;
    questions: number;
    tracks: number;
    practicalQuestions: number;
    progressEvents: number;
  }[];
  lectures: {
    lectures: {
      id: string;
      title: string;
      kind: string | null;
      moduleName: string;
      studyYear: number;
      term: number;
      hasContent: boolean;
      hasPdf: boolean;
      hasSummary: boolean;
      hasMindmap: boolean;
      progressEvents: number;
    }[];
    total: number;
    page: number;
    limit: number;
  };
  range: string;
};

export type LearningSeries = {
  days: { day: string; lectures: number; quizzes: number; practical: number; flashcards: number; cases: number }[];
  totals: { lectures: number; quizzes: number; practical: number; flashcards: number; cases: number };
  range: string;
};

export type ActivityResponse = {
  events: { type: string; userId: string; userName: string; ts: string; title: string | null; entity: string | null }[];
  range: string;
};

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

export type PaymentsResponse = {
  enabled: boolean;
  byStatus: { status: string; total: number; amountEg: number }[];
  byMethod: { method: string; total: number; amountEg: number }[];
  range: string;
};

export type AiResponse = {
  dailyLimit: number;
  usedToday: number;
  daily: { day: string; used: number }[];
  buckets: { pct0: number; pct25: number; pct50: number; pct75: number; pct100: number; unused: number };
  hosted: { calls: number; inputTokens: number; outputTokens: number };
  features: { feature: string; total: number; completed: number; failed: number; quota: number }[];
  topUsers: { id: string; name: string; email: string; total: number }[];
  tokens: { input: number; output: number };
  groqConfigured: boolean;
  costPricingConfigured: boolean;
  range: string;
};

export type XpResponse = {
  totals: { totalXp: number; profiles: number; activeStreaks: number; avgStreak: number; battlesWon: number; battlesLost: number };
  byReason: { reason: string; events: number; amount: number }[];
  leaderboard: { rank: number; id: string; name: string; totalXp: number; level: number; streak: number; battlesWon: number; battlesLost: number }[];
  daily: { day: string; xp: number; events: number }[];
  todayUsers: { id: string; name: string; events: number; total: number }[];
  range: string;
};

export type QuizResponse = {
  summary: { total: number; completed: number; inProgress: number; abandoned: number; avgScorePct: number };
  difficulty: { difficulty: string; attempts: number; avgPct: number }[];
  perModule: { id: string; name: string; slug: string; attempts: number; students: number; avgPct: number }[];
  range: string;
};

export type PracticalResponse = {
  tracks: { status: string; total: number; practiceEnabled: number; ospeEnabled: number }[];
  trackTotal: number;
  byStatus: { status: string; total: number }[];
  byReview: { status: string; total: number }[];
  submissions: { total: number; users: number };
  progress: { attempts: number; trackedRows: number; difficult: number; bookmarked: number };
  range: string;
};

export type OspeResponse = {
  stationsConfigured: number;
  exams: { status: string; total: number; avgPct: number }[];
  tracks: {
    id: string;
    subject: string;
    displayNameEn: string;
    displayNameAr: string | null;
    status: string;
    practiceEnabled: boolean;
    ospeEnabled: boolean;
    stationBindings: number;
  }[];
  range: string;
};

export type ReviewResponse = {
  flashcards: { total: number; createdInRange: number; dueNow: number };
  flashcardReviews: { reviews: number; users: number };
  mostDue: { lectureTitle: string; moduleName: string; dueCount: number }[];
  cases: { total: number; lecturesCovered: number; createdInRange: number };
  caseEvaluations: { total: number; inRange: number; users: number; avgScore: number };
  range: string;
};