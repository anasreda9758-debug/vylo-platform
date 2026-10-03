export const OSPE_REVIEW_SUBJECTS = [
  "Anatomy",
  "Histology",
  "Pathology",
  "Microbiology",
  "Physiology",
  "Biochemistry",
  "Unknown",
] as const;

export const OSPE_REVIEW_VERDICTS = [
  "CONFIRM_SUBJECT",
  "NEEDS_FURTHER_REVIEW",
  "INVALID_STATION",
] as const;

export type OspeReviewSubject = (typeof OSPE_REVIEW_SUBJECTS)[number];
export type OspeReviewVerdict = (typeof OSPE_REVIEW_VERDICTS)[number];
export type OspeAssetStatus = "IMAGE_OK" | "IMAGE_MISSING" | "IMAGE_NOT_REQUIRED";
export type OspeConfirmedReadiness =
  | "READY_FOR_MAPPING"
  | "READY_FOR_OSPE"
  | "BLOCKED_ASSET"
  | "MISSING_TRACK";

export interface OspeHumanDecision {
  answerKeyId: string;
  subject: OspeReviewSubject;
  verdict: OspeReviewVerdict;
  note: string;
}

export interface OspeReviewStation {
  answerKeyId: string;
  stationId?: string;
  title?: string | null;
  prompt?: string | null;
  moduleEvidence: {
    moduleId: string;
    moduleSlug: string;
    moduleName?: string;
    explicit?: boolean;
  } | null;
  answerKey?: {
    diagnosis?: string | null;
    identification?: string | null;
    findings?: string | null;
    differential?: string | null;
    management?: string | null;
  };
  rubrics?: Array<{
    criterion?: string | null;
    maxPoints?: number | null;
    order?: number | null;
  }>;
  sourceReferences?: Array<{ path?: string | null }>;
  image?: {
    exactFileExists?: boolean;
    previewPath?: string | null;
  };
  assetStatus?: OspeAssetStatus;
  imageRequired?: boolean;
  answerAndRubricPresent?: boolean;
}

export interface OspePracticalTrack {
  id: string;
  moduleId: string;
  moduleSlug: string;
  moduleName?: string;
  subject: string;
  subjectSlug: string;
  status: string;
  ospeEnabled: boolean;
}

export type OspeValidationCode =
  | "INVALID_DECISION_RECORD"
  | "INVALID_ANSWER_KEY_ID"
  | "DUPLICATE_ANSWER_KEY_ID"
  | "UNKNOWN_ANSWER_KEY_ID"
  | "STATION_NO_LONGER_EXISTS"
  | "INVALID_SUBJECT"
  | "INVALID_VERDICT"
  | "UNKNOWN_SUBJECT_CANNOT_BE_CONFIRMED"
  | "CONFLICTING_EXACT_DUPLICATE_DECISIONS"
  | "MISSING_EXPLICIT_MODULE_EVIDENCE"
  | "MODULE_TRACK_MISMATCH"
  | "SUBJECT_TRACK_MISMATCH"
  | "AMBIGUOUS_TARGET_TRACK";

export interface OspeValidationIssue {
  code: OspeValidationCode;
  message: string;
}

export interface OspeRejectedDecision {
  inputIndex: number;
  answerKeyId: string | null;
  decision: unknown;
  issues: OspeValidationIssue[];
}

export interface OspeDryRunEntry {
  answerKeyId: string;
  stationId: string;
  subject: OspeReviewSubject;
  verdict: OspeReviewVerdict;
  note: string;
  module: {
    id: string;
    slug: string;
    name: string | null;
  };
  exactDuplicateGroupId: string | null;
  practicalTrack: {
    id: string;
    moduleId: string;
    moduleSlug: string;
    subject: string;
    subjectSlug: string;
    status: string;
    ospeEnabled: boolean;
  } | null;
  assetStatus: OspeAssetStatus;
  readiness: OspeConfirmedReadiness | "NEEDS_REVIEW" | "INVALID_STATION";
  readyForMapping: boolean;
  readyForOspe: boolean;
}

export interface OspeDryRunBreakdownRow {
  total: number;
  validConfirmed: number;
  needsReview: number;
  invalid: number;
  readyForMapping: number;
  readyForOspe: number;
  blockedAsset: number;
  missingTrack: number;
}

export interface OspeMappingDryRun {
  schemaVersion: 1;
  mode: "READ_ONLY_DRY_RUN";
  generatedAt: string;
  safety: {
    databaseWrites: false;
    mappingsModified: false;
    tracksCreated: false;
    ospeEnabled: false;
    subjectInferenceUsed: false;
  };
  summary: {
    totalDecisions: number;
    validConfirmed: number;
    needsReview: number;
    invalid: number;
    rejected: number;
    readyForMapping: number;
    readyForOspe: number;
    blockedAsset: number;
    missingTrack: number;
  };
  breakdown: {
    byModule: Record<string, OspeDryRunBreakdownRow>;
    bySubject: Record<string, OspeDryRunBreakdownRow>;
    byPracticalTrack: Record<string, OspeDryRunBreakdownRow>;
  };
  entries: OspeDryRunEntry[];
  rejected: OspeRejectedDecision[];
}

interface PipelineInput {
  decisions: unknown;
  stations: OspeReviewStation[];
  existingAnswerKeyIds: Iterable<string>;
  practicalTracks: OspePracticalTrack[];
  generatedAt?: string;
}

interface ParsedDecision extends OspeHumanDecision {
  inputIndex: number;
  raw: unknown;
}

const SUBJECT_SET = new Set<string>(OSPE_REVIEW_SUBJECTS);
const VERDICT_SET = new Set<string>(OSPE_REVIEW_VERDICTS);

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ");
}

function stableExactDuplicateKey(station: OspeReviewStation) {
  const moduleEvidence = station.moduleEvidence;
  if (!moduleEvidence?.explicit || !moduleEvidence.moduleId || !moduleEvidence.moduleSlug) return null;

  const answerKey = station.answerKey ?? {};
  const rubrics = [...(station.rubrics ?? [])]
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((rubric) => [
      normalizeText(rubric.criterion),
      rubric.maxPoints ?? null,
      rubric.order ?? null,
    ]);
  const sources = (station.sourceReferences ?? [])
    .map((source) => normalizeText(source.path))
    .filter(Boolean)
    .sort();

  return JSON.stringify({
    moduleId: moduleEvidence.moduleId,
    moduleSlug: moduleEvidence.moduleSlug,
    prompt: normalizeText(station.prompt),
    answerKey: [
      normalizeText(answerKey.diagnosis),
      normalizeText(answerKey.identification),
      normalizeText(answerKey.findings),
      normalizeText(answerKey.differential),
      normalizeText(answerKey.management),
    ],
    rubrics,
    sources,
  });
}

/**
 * Reconstructs the exact-review groups with the same conservative evidence
 * boundary documented by reports/ospe-human-review-grouped.html. Image paths
 * are deliberately excluded because asset readiness remains station-specific.
 */
export function buildExactDuplicateGroupIndex(stations: OspeReviewStation[]) {
  const candidates = new Map<string, string[]>();
  for (const station of stations) {
    const key = stableExactDuplicateKey(station);
    if (!key) continue;
    const ids = candidates.get(key) ?? [];
    ids.push(station.answerKeyId);
    candidates.set(key, ids);
  }

  const result = new Map<string, string>();
  let index = 0;
  for (const ids of candidates.values()) {
    if (ids.length < 2) continue;
    index += 1;
    const groupId = `exact-${String(index).padStart(3, "0")}`;
    for (const id of ids.sort()) result.set(id, groupId);
  }
  return result;
}

function pushIssue(
  issueMap: Map<number, OspeValidationIssue[]>,
  inputIndex: number,
  issue: OspeValidationIssue,
) {
  const issues = issueMap.get(inputIndex) ?? [];
  if (!issues.some((existing) => existing.code === issue.code)) issues.push(issue);
  issueMap.set(inputIndex, issues);
}

function parseDecision(
  raw: unknown,
  inputIndex: number,
  issueMap: Map<number, OspeValidationIssue[]>,
): ParsedDecision {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    pushIssue(issueMap, inputIndex, {
      code: "INVALID_DECISION_RECORD",
      message: "Decision must be an object.",
    });
  }

  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const answerKeyId = typeof value.answerKeyId === "string" ? value.answerKeyId.trim() : "";
  const subject = typeof value.subject === "string" ? value.subject.trim() : "";
  const verdict = typeof value.verdict === "string" ? value.verdict.trim() : "";
  const note = value.note === undefined ? "" : value.note;

  if (!answerKeyId) {
    pushIssue(issueMap, inputIndex, {
      code: "INVALID_ANSWER_KEY_ID",
      message: "answerKeyId must be a non-empty string.",
    });
  }
  if (!SUBJECT_SET.has(subject)) {
    pushIssue(issueMap, inputIndex, {
      code: "INVALID_SUBJECT",
      message: `Subject ${JSON.stringify(subject)} is not allowed.`,
    });
  }
  if (!VERDICT_SET.has(verdict)) {
    pushIssue(issueMap, inputIndex, {
      code: "INVALID_VERDICT",
      message: `Verdict ${JSON.stringify(verdict)} is not allowed.`,
    });
  }
  if (typeof note !== "string") {
    pushIssue(issueMap, inputIndex, {
      code: "INVALID_DECISION_RECORD",
      message: "note must be a string when present.",
    });
  }
  if (verdict === "CONFIRM_SUBJECT" && subject === "Unknown") {
    pushIssue(issueMap, inputIndex, {
      code: "UNKNOWN_SUBJECT_CANNOT_BE_CONFIRMED",
      message: "CONFIRM_SUBJECT requires a named medical subject.",
    });
  }

  return {
    answerKeyId,
    subject: subject as OspeReviewSubject,
    verdict: verdict as OspeReviewVerdict,
    note: typeof note === "string" ? note : "",
    inputIndex,
    raw,
  };
}

function subjectToTrackValue(subject: OspeReviewSubject) {
  return subject.toUpperCase();
}

function subjectToSlug(subject: OspeReviewSubject) {
  return subject.toLocaleLowerCase("en");
}

function getAssetStatus(station: OspeReviewStation): OspeAssetStatus {
  if (station.assetStatus) return station.assetStatus;
  if (station.imageRequired === false) return "IMAGE_NOT_REQUIRED";
  return station.image?.exactFileExists || station.image?.previewPath ? "IMAGE_OK" : "IMAGE_MISSING";
}

function hasAnswerAndRubric(station: OspeReviewStation) {
  if (typeof station.answerAndRubricPresent === "boolean") return station.answerAndRubricPresent;
  const answer = station.answerKey ?? {};
  const hasAnswer = [
    answer.diagnosis,
    answer.identification,
    answer.findings,
    answer.differential,
    answer.management,
  ].some((value) => normalizeText(value).length > 0);
  const hasRubric = (station.rubrics ?? []).some((rubric) => normalizeText(rubric.criterion).length > 0);
  return hasAnswer && hasRubric;
}

function blankBreakdownRow(): OspeDryRunBreakdownRow {
  return {
    total: 0,
    validConfirmed: 0,
    needsReview: 0,
    invalid: 0,
    readyForMapping: 0,
    readyForOspe: 0,
    blockedAsset: 0,
    missingTrack: 0,
  };
}

function addToBreakdown(row: OspeDryRunBreakdownRow, entry: OspeDryRunEntry) {
  row.total += 1;
  if (entry.verdict === "CONFIRM_SUBJECT") row.validConfirmed += 1;
  if (entry.verdict === "NEEDS_FURTHER_REVIEW") row.needsReview += 1;
  if (entry.verdict === "INVALID_STATION") row.invalid += 1;
  if (entry.readyForMapping) row.readyForMapping += 1;
  if (entry.readyForOspe) row.readyForOspe += 1;
  if (entry.readiness === "BLOCKED_ASSET") row.blockedAsset += 1;
  if (entry.readiness === "MISSING_TRACK") row.missingTrack += 1;
}

function groupEntries(entries: OspeDryRunEntry[], key: (entry: OspeDryRunEntry) => string) {
  const result: Record<string, OspeDryRunBreakdownRow> = {};
  for (const entry of entries) {
    const value = key(entry);
    const row = result[value] ?? blankBreakdownRow();
    addToBreakdown(row, entry);
    result[value] = row;
  }
  return result;
}

export function buildOspeMappingDryRun(input: PipelineInput): OspeMappingDryRun {
  if (!Array.isArray(input.decisions)) {
    throw new TypeError("OSPE decisions file must contain a JSON array.");
  }

  const stationsById = new Map(input.stations.map((station) => [station.answerKeyId, station]));
  const existingAnswerKeyIds = new Set(input.existingAnswerKeyIds);
  const exactGroups = buildExactDuplicateGroupIndex(input.stations);
  const issues = new Map<number, OspeValidationIssue[]>();
  const decisions = input.decisions.map((raw, index) => parseDecision(raw, index, issues));

  const decisionIndexesById = new Map<string, number[]>();
  for (const decision of decisions) {
    if (!decision.answerKeyId) continue;
    const indexes = decisionIndexesById.get(decision.answerKeyId) ?? [];
    indexes.push(decision.inputIndex);
    decisionIndexesById.set(decision.answerKeyId, indexes);
  }
  for (const [answerKeyId, indexes] of decisionIndexesById) {
    if (indexes.length < 2) continue;
    for (const inputIndex of indexes) {
      pushIssue(issues, inputIndex, {
        code: "DUPLICATE_ANSWER_KEY_ID",
        message: `answerKeyId ${answerKeyId} occurs more than once in the decisions file.`,
      });
    }
  }

  for (const decision of decisions) {
    if (!decision.answerKeyId) continue;
    const station = stationsById.get(decision.answerKeyId);
    if (!station) {
      pushIssue(issues, decision.inputIndex, {
        code: "UNKNOWN_ANSWER_KEY_ID",
        message: `answerKeyId ${decision.answerKeyId} is not present in the reviewed station inventory.`,
      });
      continue;
    }
    if (!existingAnswerKeyIds.has(decision.answerKeyId)) {
      pushIssue(issues, decision.inputIndex, {
        code: "STATION_NO_LONGER_EXISTS",
        message: `answerKeyId ${decision.answerKeyId} no longer exists in the current database.`,
      });
    }
    if (!station.moduleEvidence?.explicit) {
      pushIssue(issues, decision.inputIndex, {
        code: "MISSING_EXPLICIT_MODULE_EVIDENCE",
        message: "The station has no authoritative module evidence and cannot be planned safely.",
      });
    }
  }

  const decisionsByExactGroup = new Map<string, ParsedDecision[]>();
  for (const decision of decisions) {
    if ((issues.get(decision.inputIndex) ?? []).length > 0) continue;
    const groupId = exactGroups.get(decision.answerKeyId);
    if (!groupId) continue;
    const groupDecisions = decisionsByExactGroup.get(groupId) ?? [];
    groupDecisions.push(decision);
    decisionsByExactGroup.set(groupId, groupDecisions);
  }
  for (const [groupId, groupDecisions] of decisionsByExactGroup) {
    const signatures = new Set(groupDecisions.map((decision) => `${decision.subject}|${decision.verdict}`));
    if (signatures.size < 2) continue;
    for (const decision of groupDecisions) {
      pushIssue(issues, decision.inputIndex, {
        code: "CONFLICTING_EXACT_DUPLICATE_DECISIONS",
        message: `Decision conflicts with another decision in exact-duplicate group ${groupId}.`,
      });
    }
  }

  const entries: OspeDryRunEntry[] = [];
  for (const decision of decisions) {
    if ((issues.get(decision.inputIndex) ?? []).length > 0) continue;
    const station = stationsById.get(decision.answerKeyId);
    const moduleEvidence = station?.moduleEvidence;
    if (!station || !moduleEvidence) continue;

    let practicalTrack: OspePracticalTrack | null = null;
    if (decision.verdict === "CONFIRM_SUBJECT") {
      const trackSubject = subjectToTrackValue(decision.subject);
      const trackSlug = subjectToSlug(decision.subject);
      const sameConfiguredScope = input.practicalTracks.filter((track) =>
        track.moduleSlug === moduleEvidence.moduleSlug
        && (track.subject === trackSubject || track.subjectSlug === trackSlug)
        && track.status !== "ARCHIVED"
      );
      const crossModuleTrack = sameConfiguredScope.find((track) => track.moduleId !== moduleEvidence.moduleId);
      if (crossModuleTrack) {
        pushIssue(issues, decision.inputIndex, {
          code: "MODULE_TRACK_MISMATCH",
          message: `Track ${crossModuleTrack.id} claims module slug ${moduleEvidence.moduleSlug} but belongs to another module ID.`,
        });
        continue;
      }

      const matchingTracks = sameConfiguredScope.filter((track) => track.moduleId === moduleEvidence.moduleId);
      if (matchingTracks.length > 1) {
        pushIssue(issues, decision.inputIndex, {
          code: "AMBIGUOUS_TARGET_TRACK",
          message: `More than one active practical track matches ${moduleEvidence.moduleSlug} + ${decision.subject}.`,
        });
        continue;
      }
      practicalTrack = matchingTracks[0] ?? null;
      if (practicalTrack && (practicalTrack.subject !== trackSubject || practicalTrack.subjectSlug !== trackSlug)) {
        pushIssue(issues, decision.inputIndex, {
          code: "SUBJECT_TRACK_MISMATCH",
          message: `Track ${practicalTrack.id} does not match the confirmed subject exactly.`,
        });
        continue;
      }
    }

    const assetStatus = getAssetStatus(station);
    const answerAndRubricPresent = hasAnswerAndRubric(station);
    let readiness: OspeDryRunEntry["readiness"] = "NEEDS_REVIEW";
    let readyForMapping = false;
    let readyForOspe = false;

    if (decision.verdict === "INVALID_STATION") {
      readiness = "INVALID_STATION";
    } else if (decision.verdict === "CONFIRM_SUBJECT") {
      if (!practicalTrack) {
        readiness = "MISSING_TRACK";
      } else {
        readyForMapping = true;
        if (assetStatus === "IMAGE_MISSING") {
          readiness = "BLOCKED_ASSET";
        } else if (answerAndRubricPresent) {
          readiness = "READY_FOR_OSPE";
          readyForOspe = true;
        } else {
          readiness = "READY_FOR_MAPPING";
        }
      }
    }

    entries.push({
      answerKeyId: decision.answerKeyId,
      stationId: station.stationId ?? station.answerKeyId,
      subject: decision.subject,
      verdict: decision.verdict,
      note: decision.note,
      module: {
        id: moduleEvidence.moduleId,
        slug: moduleEvidence.moduleSlug,
        name: moduleEvidence.moduleName ?? null,
      },
      exactDuplicateGroupId: exactGroups.get(decision.answerKeyId) ?? null,
      practicalTrack: practicalTrack ? {
        id: practicalTrack.id,
        moduleId: practicalTrack.moduleId,
        moduleSlug: practicalTrack.moduleSlug,
        subject: practicalTrack.subject,
        subjectSlug: practicalTrack.subjectSlug,
        status: practicalTrack.status,
        ospeEnabled: practicalTrack.ospeEnabled,
      } : null,
      assetStatus,
      readiness,
      readyForMapping,
      readyForOspe,
    });
  }

  const rejected = decisions
    .filter((decision) => (issues.get(decision.inputIndex) ?? []).length > 0)
    .map((decision) => ({
      inputIndex: decision.inputIndex,
      answerKeyId: decision.answerKeyId || null,
      decision: decision.raw,
      issues: issues.get(decision.inputIndex) ?? [],
    }));

  return {
    schemaVersion: 1,
    mode: "READ_ONLY_DRY_RUN",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    safety: {
      databaseWrites: false,
      mappingsModified: false,
      tracksCreated: false,
      ospeEnabled: false,
      subjectInferenceUsed: false,
    },
    summary: {
      totalDecisions: decisions.length,
      validConfirmed: entries.filter((entry) => entry.verdict === "CONFIRM_SUBJECT").length,
      needsReview: entries.filter((entry) => entry.verdict === "NEEDS_FURTHER_REVIEW").length,
      invalid: entries.filter((entry) => entry.verdict === "INVALID_STATION").length,
      rejected: rejected.length,
      readyForMapping: entries.filter((entry) => entry.readyForMapping).length,
      readyForOspe: entries.filter((entry) => entry.readyForOspe).length,
      blockedAsset: entries.filter((entry) => entry.readiness === "BLOCKED_ASSET").length,
      missingTrack: entries.filter((entry) => entry.readiness === "MISSING_TRACK").length,
    },
    breakdown: {
      byModule: groupEntries(entries, (entry) => entry.module.slug),
      bySubject: groupEntries(entries, (entry) => entry.subject),
      byPracticalTrack: groupEntries(entries, (entry) => entry.practicalTrack?.id ?? (
        entry.verdict === "CONFIRM_SUBJECT" ? "MISSING_TRACK" : "NOT_APPLICABLE"
      )),
    },
    entries,
    rejected,
  };
}

function markdownBreakdown(title: string, rows: Record<string, OspeDryRunBreakdownRow>) {
  const lines = [
    `## ${title}`,
    "",
    "| Scope | Total | Confirmed | Needs review | Invalid | Ready mapping | Ready OSPE | Blocked asset | Missing track |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const [key, row] of Object.entries(rows).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`| ${key} | ${row.total} | ${row.validConfirmed} | ${row.needsReview} | ${row.invalid} | ${row.readyForMapping} | ${row.readyForOspe} | ${row.blockedAsset} | ${row.missingTrack} |`);
  }
  if (Object.keys(rows).length === 0) lines.push("| — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |");
  return lines.join("\n");
}

export function renderOspeMappingDryRunMarkdown(plan: OspeMappingDryRun) {
  const summary = plan.summary;
  const lines = [
    "# OSPE Mapping Dry Run",
    "",
    `Generated: ${plan.generatedAt}`,
    "",
    "> READ-ONLY planning artifact. No database mapping was written, no practical track was created, and OSPE was not enabled.",
    "",
    "## Summary",
    "",
    `- **TOTAL DECISIONS:** ${summary.totalDecisions}`,
    `- **VALID CONFIRMED:** ${summary.validConfirmed}`,
    `- **NEEDS REVIEW:** ${summary.needsReview}`,
    `- **INVALID:** ${summary.invalid}`,
    `- **REJECTED:** ${summary.rejected}`,
    `- **READY_FOR_MAPPING:** ${summary.readyForMapping}`,
    `- **READY_FOR_OSPE:** ${summary.readyForOspe}`,
    `- **BLOCKED_ASSET:** ${summary.blockedAsset}`,
    `- **MISSING_TRACK:** ${summary.missingTrack}`,
    "",
    markdownBreakdown("By module", plan.breakdown.byModule),
    "",
    markdownBreakdown("By subject", plan.breakdown.bySubject),
    "",
    markdownBreakdown("By practical track", plan.breakdown.byPracticalTrack),
    "",
    "## Rejected decisions",
    "",
  ];

  if (plan.rejected.length === 0) {
    lines.push("None.");
  } else {
    for (const rejected of plan.rejected) {
      lines.push(`- ${rejected.answerKeyId ?? `input ${rejected.inputIndex}`}: ${rejected.issues.map((issue) => `${issue.code} — ${issue.message}`).join("; ")}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
