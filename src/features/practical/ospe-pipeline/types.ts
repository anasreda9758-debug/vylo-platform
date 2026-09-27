export const PIPELINE_STAGES = ["DISCOVER", "PARSE", "EXTRACT", "NORMALIZE", "VALIDATE", "REVIEW_BATCH", "APPROVE", "PUBLISH"] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

export interface PdfReference {
  name: string;
  file: string;
  folder: string;
}

export const QUESTION_KINDS = [
  "IMAGE_IDENTIFY_STRUCTURE",
  "IMAGE_IDENTIFY_PART",
  "IMAGE_RELATED_STRUCTURE",
  "IMAGE_DIAGNOSIS",
  "IMAGE_LAB_IDENTIFICATION",
  "IMAGE_SURFACE_ANATOMY",
  "TEXT_OR_IMAGE_MCQ",
  "IMAGE_MARKED_REGION",
] as const;
export type QuestionKind = typeof QUESTION_KINDS[number];

export const REVIEW_STATUSES = ["DRAFT", "NEEDS_REVIEW", "AUTO_VERIFIED_SOURCE", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = typeof REVIEW_STATUSES[number];

export interface Traceability {
  sourcePdf: string;
  sourcePage: number;
  sourceQuestionNumber: number | null;
}

export interface ExtractedOption {
  id: string;
  text: string;
  source: "pdf" | "distractor-pool" | "ai" | null;
}

export interface ExtractedQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: ExtractedOption[];
  correctOptionId: string;
  answer: string | null;
  traceability: Traceability;
  needsReview: boolean;
  reviewReasons: string[];
  markers: Array<{ id: string; label: string | null }>;
}

export interface DryRunRow {
  index: number;
  kind: QuestionKind;
  status: "CONFIDENT" | "NEEDS_REVIEW";
  traceability: Traceability;
  prompt: string;
  optionCount: number;
  answerFound: boolean;
  imageExists: boolean;
  reasons: string[];
}

export interface DryRunReport {
  schemaVersion: 1;
  mode: "READ_ONLY_DRY_RUN";
  generatedAt: string;
  sourcePdf: string;
  summary: {
    total: number;
    confident: number;
    needsReview: number;
    byKind: Record<QuestionKind, number>;
  };
  rows: DryRunRow[];
  rejected: Array<{ index: number; reasons: string[] }>;
}
