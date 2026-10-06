/**
 * Final VYLO practical question model, built from a PDF question block.
 *
 * Source of truth is the PDF. A question is SOURCE_PDF_QUESTION when it is a
 * real exam item, and DERIVED_FROM_VERIFIED_SOURCE when it was generated from
 * verified source facts (e.g. a short-answer deck converted to practice MCQ).
 */

export type SourceKind = "SOURCE_PDF_QUESTION" | "DERIVED_FROM_VERIFIED_SOURCE";
export type Origin = "SOURCE_MCQ" | "SHORT_ANSWER_DERIVED" | "IMAGE_ONLY_OCR_CANDIDATE";

export type QuestionType =
  | "IMAGE_MCQ"
  | "MULTI_IMAGE_MCQ"
  | "IMAGE_IDENTIFICATION"
  | "IMAGE_DIAGNOSIS"
  | "IMAGE_FEATURE"
  | "HISTOLOGY_IMAGE"
  | "ANATOMY_SPOTTER"
  | "MICROBIOLOGY_IMAGE"
  | "DEVICE_IMAGE"
  | "PROCEDURE_IMAGE";

export type ReviewStatus = "AUTO_VERIFIED" | "NEEDS_REVIEW" | "REJECTED";

export type Option = {
  id: string;
  label: string;
  text: string;
  isCorrect: boolean;
  /** Where the option text came from. */
  provenance: "SOURCE_PDF" | "VERIFIED_SOURCE_FACT";
};

export type QuestionImage = {
  /** Path to the PDF-derived crop on disk (spike/dry-run only). */
  cropPath: string;
  /** Data URL for the self-contained review report. */
  dataUrl?: string;
  sourceMarkerPreserved: boolean;
  /** Composite panels stay in one crop unless splitting is deterministic. */
  panelCount: number;
};

export type PdfProvenance = {
  sourcePdf: string;
  sourcePage: number;
  sourceQuestionNumber: number | null;
  questionBlockBBox: [number, number, number, number];
  answerRegion: [number, number, number, number] | null;
  visualRegions: Array<[number, number, number, number]>;
};

export type PracticalQuestion = {
  id: string;
  sourceType: SourceKind;
  origin: Origin;
  subject: string;
  questionType: QuestionType;
  /** Verbatim from the PDF. Never rewritten into a generic "identify the arrow". */
  stem: string;
  images: QuestionImage[];
  options: Option[];
  /** ADMIN ONLY. Never serialised into a student payload. */
  correctAnswerText: string | null;
  answerVerified: boolean;
  answerProvenance: "PDF_PRINTED_ANSWER" | "SOURCE_ANSWER_KEY" | "UNVERIFIED" | null;
  sourceOptionCount: number;
  studentOptionCount: number;
  /** Only true for genuine manual spotter questions. */
  targetCoordinatesRequired: boolean;
  sourceMarkerPresent: boolean;
  cropSafe: boolean;
  nextQuestionContamination: boolean;
  reviewStatus: ReviewStatus;
  warnings: string[];
  provenance: PdfProvenance;
};

/* ------------------------------------------------------------------ */
/* option policy                                                       */
/* ------------------------------------------------------------------ */

/**
 * Source MCQs keep their original option count. A university 4-option question
 * must never grow a fifth choice, and a 5-option question must never be cut.
 */
export const buildSourceMcqOptions = (sourceOptions: Array<{ label: string; text: string }>, correctText: string | null): Option[] =>
  sourceOptions.map((o, i) => ({
    id: `opt-${i + 1}`,
    label: o.label,
    text: o.text,
    isCorrect: !!correctText && o.text.trim().toLowerCase() === correctText.trim().toLowerCase(),
    provenance: "SOURCE_PDF" as const,
  }));

/**
 * Short-answer source questions become 5-choice practice items. The correct
 * answer must be verified; distractors must be real verified same-category
 * source facts. If 4 safe distractors do not exist the item is NEEDS_REVIEW —
 * it is never padded.
 */
export const buildDerivedOptions = (
  correctText: string,
  distractorPool: string[],
): { options: Option[]; warnings: string[] } => {
  const warnings: string[] = [];
  const norm = (s: string) => s.trim().toLowerCase().replace(/[.;,]+$/, "");
  const seen = new Set([norm(correctText)]);
  const distractors: string[] = [];
  for (const d of distractorPool) {
    const k = norm(d);
    if (seen.has(k)) continue;
    seen.add(k);
    distractors.push(d);
    if (distractors.length === 4) break;
  }
  if (distractors.length < 4) {
    warnings.push(`only ${distractors.length} verified same-category distractors available; needs review, not padded`);
  }
  const options: Option[] = [
    { id: "opt-1", label: "A", text: correctText, isCorrect: true, provenance: "VERIFIED_SOURCE_FACT" },
    ...distractors.map((d, i) => ({
      id: `opt-${i + 2}`,
      label: String.fromCharCode(66 + i),
      text: d,
      isCorrect: false,
      provenance: "VERIFIED_SOURCE_FACT" as const,
    })),
  ];
  return { options, warnings };
};

/* ------------------------------------------------------------------ */
/* student payload                                                     */
/* ------------------------------------------------------------------ */

export type StudentQuestionPayload = {
  id: string;
  stem: string;
  questionType: QuestionType;
  images: Array<{ url: string; alt: string }>;
  options: Array<{ id: string; label: string; text: string }>;
  /** Some image questions are valid with no coordinate target. */
  targetCoordinatesRequired: boolean;
};

/**
 * The student payload is the security boundary: it must never carry the correct
 * answer, the answer key, or any admin-only review metadata.
 */
export const toStudentPayload = (q: PracticalQuestion, imageUrlFor: (p: string) => string): StudentQuestionPayload => ({
  id: q.id,
  stem: q.stem,
  questionType: q.questionType,
  images: q.images.map((im) => ({ url: imageUrlFor(im.cropPath), alt: q.stem })),
  options: q.options.map((o) => ({ id: o.id, label: o.label, text: o.text })),
  targetCoordinatesRequired: q.targetCoordinatesRequired,
});

/** Only these keys may reach a student. Used by tests and by the admin UI. */
export const STUDENT_SAFE_KEYS: ReadonlyArray<keyof StudentQuestionPayload> = [
  "id", "stem", "questionType", "images", "options", "targetCoordinatesRequired",
];
