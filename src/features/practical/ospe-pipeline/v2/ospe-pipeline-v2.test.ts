import { describe, expect, it } from "vitest";
import { inferModuleAndSubject, roleFromPageClassifications, normaliseStem } from "./corpus";
import { dedupeRepeatedPhrase } from "./pageParse";
import {
  classifyPage,
  isQuestionPage,
  isContinuationFragment,
  mergeWrappedCaptions,
  matchPromptFamily,
  NUMBERED_STEM,
  countOptionLetters,
  type PageClass,
} from "./classifyPage";
import { detectQuestionsOnPage, inferQuestionType, isSelfEcho } from "./detectQuestions";
import { renderDryRunMarkdownV2, type DryRunReport } from "./dryRunV2";
import type { CorpusDoc } from "./corpus";
import type { PageDoc } from "./pageParse";

const DOC: CorpusDoc = {
  path: "C:/x.pdf",
  fileName: "OSPE CVS.pdf",
  duplicatePaths: [],
  sha256: "deadbeef",
  bytes: 1,
  module: "module-3",
  subjectGuess: "Cardio-Vascular System",
  role: "UNKNOWN",
  pageCount: null,
  notes: [],
};

type Span = { text: string; x: number; y: number; width: number; height: number; fontSize: number };
function line(text: string, x: number, y: number, width = 200, height = 12): PageDoc["lines"][number] {
  const s: Span = { text, x, y, width, height, fontSize: height };
  return { text, x, y, width, height, spans: [s] };
}

function page(lines: PageDoc["lines"], over: Partial<PageDoc> = {}): PageDoc {
  return {
    page: 1,
    width: 595,
    height: 842,
    lines,
    text: lines.map((l) => l.text).join("\n"),
    imageOps: 2,
    vectorOps: 20,
    colourOps: 5,
    hasSourceMarker: true,
    ...over,
  };
}

describe("1. page-aware parsing keeps real page boundaries", () => {
  it("assigns each line to the page it was parsed from", () => {
    const p1 = page([line("Q1) First", 10, 700)]);
    const p2 = page([line("Q2) Second", 10, 700)], { page: 2 });
    expect(p1.page).toBe(1);
    expect(p2.page).toBe(2);
    expect(p1.text).not.toContain("Second");
  });
});

describe("2. two questions on one page are separate candidates", () => {
  it("splits a page holding Q6 and Q7 with their own answers", () => {
    const p = page([
      line("6 ) This artery is a branch from:", 50, 683),
      line("Left coronary artery .", 50, 650),
      line("7 ) Identify this vein:", 50, 291),
      line("Great cardiac vein.", 50, 253),
    ]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER");
    expect(qs).toHaveLength(2);
    expect(qs[0].sourceQuestionNumber).toBe(6);
    expect(qs[0].answer).toBe("Left coronary artery");
    expect(qs[1].sourceQuestionNumber).toBe(7);
    expect(qs[1].answer).toBe("Great cardiac vein");
  });
});

describe("3. numbering across pages is preserved and gaps are detectable", () => {
  it("keeps the source question number and finds the missing one", () => {
    const p = page([line("Q1) Alpha", 50, 700), line("Beta", 50, 670)]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER");
    expect(qs[0].sourceQuestionNumber).toBe(1);

    const seen = [1, 3, 4];
    const gaps: number[] = [];
    for (let n = Math.min(...seen); n <= Math.max(...seen); n++) if (!seen.includes(n)) gaps.push(n);
    expect(gaps).toEqual([2]);
  });

  it("recognises every documented numbering style", () => {
    for (const s of ["Q1) x", "Q1: x", "Q 1 x", "1) x", "1. x", "Question 1 x"]) {
      expect(NUMBERED_STEM.test(s), s).toBe(true);
    }
  });
});

describe("4. repeated unnumbered prompts are not collapsed", () => {
  it("returns one candidate per repeated 'Identify the labeled structure:'", () => {
    const p = page([
      line("Identify the labeled structure:", 59, 656),
      line("Pharyngeal tonsil", 59, 624),
      line("Identify the labeled structure:", 64, 262),
      line("Lingual tonsil", 64, 230),
    ]);
    const qs = detectQuestionsOnPage(p, { ...DOC, subjectGuess: "Immune, Blood & Lymphatic" }, "QUESTION_SHORT_ANSWER");
    expect(qs).toHaveLength(2);
    expect(qs[0].answer).toBe("Pharyngeal tonsil");
    expect(qs[1].answer).toBe("Lingual tonsil");
    expect(qs[0].stem).toBe("Identify the labeled structure:");
    expect(qs[1].stem).toBe("Identify the labeled structure:");
  });
});

describe("5/6. source markers are preserved and no VYLO arrow is demanded", () => {
  it("uses SOURCE pointer mode when the page carries a '?' marker", () => {
    const p = page([line("Identify this chamber:", 50, 700), line("Left atrium", 50, 670), line("?", 500, 100)]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER");
    expect(qs[0].pointerMode).toBe("SOURCE");
    expect(qs[0].warnings.join(" ")).not.toMatch(/manual marker/);
  });
});

describe("7. an existing 5-choice source MCQ is preserved verbatim", () => {
  it("keeps all five source options and does not invent any", () => {
    const p = page([
      line("Q3) Identify the labeled part of this bone:", 57, 683),
      line("A. Manubrium sterni .", 57, 650),
      line("B. Body.", 57, 634),
      line("C. Xiphoid process.", 57, 617),
      line("D. Supra-sternal notch.", 57, 601),
      line("E. Clavicular notch.", 57, 585),
    ]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_MCQ");
    expect(qs).toHaveLength(1);
    expect(qs[0].sourceOptions).toEqual([
      "Manubrium sterni",
      "Body",
      "Xiphoid process",
      "Supra-sternal notch",
      "Clavicular notch",
    ]);
    expect(qs[0].questionType).toBe("TEXT_OR_IMAGE_MCQ");
  });
});

describe("9. a 4-option question cannot be published as a standard MCQ", () => {
  it("flags a source that supplied a non-5 option count", () => {
    const p = page([
      line("Q1) Pick the structure:", 50, 700),
      line("A. One.", 50, 670),
      line("B. Two.", 50, 655),
      line("C. Three.", 50, 640),
      line("D. Four.", 50, 625),
    ]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_MCQ");
    expect(qs[0].sourceOptions).toHaveLength(4);
    expect(qs[0].warnings.join(" ")).toMatch(/not 5/);
  });
});

describe("10. relation / branch wording is preserved, not flattened", () => {
  it("keeps 'This artery is a branch from:' as a relation question", () => {
    const p = page([line("6 ) This artery is a branch from:", 50, 683), line("Right coronary artery", 50, 650)]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER");
    expect(qs[0].stem).toBe("This artery is a branch from:");
    expect(qs[0].questionType).toBe("IMAGE_RELATED_STRUCTURE");
  });

  it("keeps 'Identify the structure related to this area:' as a relation question", () => {
    const p = page([line("Identify the structure related to this area:", 50, 700), line("Left suprarenal gland", 50, 670)]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER");
    expect(qs[0].stem).toBe("Identify the structure related to this area:");
    expect(qs[0].questionType).toBe("IMAGE_RELATED_STRUCTURE");
  });
});

describe("11. diagnosis works without targetX/Y", () => {
  it("types a diagnosis stem as IMAGE_DIAGNOSIS and never requires coordinates", () => {
    const p = page([line("What is the diagnosis?", 50, 700), line("Myocardial infarction", 50, 670)]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER");
    expect(qs[0].questionType).toBe("IMAGE_DIAGNOSIS");
    expect(qs[0].answer).toBe("Myocardial infarction");
    expect((qs[0] as Record<string, unknown>).targetX).toBeUndefined();
  });
});

describe("12. source provenance is preserved on every candidate", () => {
  it("retains pdf, page, module, subject and type", () => {
    const p = page([line("Q1) Identify this vein:", 50, 700), line("Coronary sinus", 50, 670)]);
    const qs = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER");
    expect(qs[0].sourcePdf).toBe("OSPE CVS.pdf");
    expect(qs[0].sourcePage).toBe(1);
    expect(qs[0].sourceQuestionNumber).toBe(1);
    expect(qs[0].module).toBe("module-3");
    expect(qs[0].subject).toBe("Cardio-Vascular System");
    expect(qs[0].questionType).toBe("IMAGE_IDENTIFY_STRUCTURE");
    expect(qs[0].answerSource).toBe("EXPLICIT_SOURCE_TEXT");
  });
});

describe("13. a reference page is never promoted into a question", () => {
  it("classifies a labelled-diagram page as reference and extracts nothing", () => {
    const p = page([line("Psoas major", 49, 480), line("Iliacus", 49, 190), line("Quadratus lumborum", 52, 181)]);
    const c = classifyPage(p);
    expect(c.class).toBe("REFERENCE_LABELLED_IMAGE");
    expect(isQuestionPage(c.class)).toBe(false);
    expect(detectQuestionsOnPage(p, DOC, c.class)).toHaveLength(0);
  });

  it("classifies an image-only page as reference", () => {
    const c = classifyPage(page([], { imageOps: 2, vectorOps: 0 }));
    expect(c.class).toBe("REFERENCE_IMAGE");
    expect(isQuestionPage(c.class)).toBe(false);
  });
});

describe("14. the two Module 3 documents stay distinct", () => {
  it("maps the exam file and the reference file to different subjects", () => {
    const exam = inferModuleAndSubject("Module 3 ospe.pdf");
    const reference = inferModuleAndSubject("Ospe module 3.pdf");
    expect(exam.subject).toBe("Module 3 Exam");
    expect(reference.subject).toBe("Reference / Mixed");
    expect(exam.subject).not.toBe(reference.subject);
  });

  it("collapses byte-identical copies but keeps differing files apart", () => {
    expect(normaliseStem("OSPE CVS (2).pdf")).toBe("OSPE CVS");
    // "OSPE RENAL.pdf-1.pdf" strips the trailing "-1" but keeps the real ".pdf"
    // in the stem, so it is visibly distinct from "OSPE RENAL.pdf".
    expect(normaliseStem("OSPE RENAL.pdf-1.pdf")).toBe("OSPE RENAL.pdf");
    expect(normaliseStem("OSPE RENAL.pdf-1.pdf")).not.toBe(normaliseStem("OSPE RENAL.pdf"));
  });
});

describe("15. an ambiguous answer becomes NEEDS_REVIEW, never a guess", () => {
  it("leaves answer null when the source marks no correct option", () => {
    const p = page([
      line("Q3) Identify the labeled part of this bone:", 57, 683),
      line("A. Manubrium.", 57, 650),
      line("B. Body.", 57, 634),
      line("C. Xiphoid.", 57, 617),
      line("D. Suprasternal notch.", 57, 601),
      line("E. Clavicular notch.", 57, 585),
    ]);
    const q = detectQuestionsOnPage(p, DOC, "QUESTION_MCQ")[0];
    expect(q.answer).toBeNull();
    expect(q.answerSource).toBe("NONE");
    expect(q.needsReview).toBe(true);
  });
});

describe("16. an ambiguous image association becomes NEEDS_REVIEW", () => {
  it("marks MANUAL pointer mode as needing review", () => {
    const p = page([line("Identify this vein:", 50, 700), line("Coronary sinus", 50, 670)], { vectorOps: 0 });
    const q = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER")[0];
    expect(q.pointerMode).toBe("MANUAL");
    expect(q.needsReview).toBe(true);
  });
});

describe("17. the answer never reaches the student payload", () => {
  it("exposes no answer field in the candidate public shape", () => {
    const p = page([line("Q1) Identify this vein:", 50, 700), line("Coronary sinus", 50, 670)]);
    const q = detectQuestionsOnPage(p, DOC, "QUESTION_SHORT_ANSWER")[0];
    // `answer` is pipeline-internal; nothing in the emitted candidate is
    // serialised into a student question by the caller.
    expect(q.options).toEqual([]);
    expect(q.correctOptionId).toBeNull();
  });
});

describe("helpers used by the pipeline", () => {
  it("maps prompt families without rewriting the stem", () => {
    expect(matchPromptFamily("Identify this chamber:")).toBe("named_structure");
    expect(matchPromptFamily("This artery is a branch from:")).toBe("branch_of");
    expect(matchPromptFamily("What is the diagnosis?")).toBe("diagnosis");
    expect(matchPromptFamily("This point refers to surface anatomy of:")).toBe("surface_anatomy");
    expect(matchPromptFamily("Identify the labeled part of this bone:")).toBe("part");
  });

  it("infers a histology label only for histology subjects", () => {
    expect(inferQuestionType("Identify the labeled structure:", { hasOptions: false, subject: "Immune, Blood & Lymphatic" }).type).toBe("HISTOLOGY_LABEL");
    expect(inferQuestionType("Identify the labeled structure:", { hasOptions: false, subject: "Cardio-Vascular System" }).type).toBe("IMAGE_IDENTIFY_STRUCTURE");
  });

  it("collapses a caption the PDF draws twice", () => {
    expect(dedupeRepeatedPhrase("Identify the structure related to this Identify the structure related to")).toBe(
      "Identify the structure related to this",
    );
  });

  it("treats a caption tail as a continuation, not an answer", () => {
    expect(isContinuationFragment("this area:")).toBe(true);
    expect(isContinuationFragment("Left suprarenal gland")).toBe(false);
  });

  it("rejoins a caption wrapped across two baselines", () => {
    const merged = mergeWrappedCaptions([
      { text: "Identify the structure related to this", x: 44, y: 207 },
      { text: "area:", x: 44, y: 193 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("Identify the structure related to this area:");
  });

  it("rejects an answer that merely echoes the stem", () => {
    expect(isSelfEcho("(thoracic outlet) is bounded by:", "Inferior aperture of thorax")).toBe(false);
    expect(isSelfEcho("this area:", "Identify the structure related to this area:")).toBe(true);
  });

  it("counts MCQ option letters including packed rows", () => {
    expect(countOptionLetters("A. one B. two C. three D. four E. five")).toBe(5);
  });

  it("derives document role from page composition", () => {
    expect(roleFromPageClassifications({ questionPages: 60, referencePages: 10, titlePages: 5, total: 75 })).toBe("PRACTICAL_QUESTION_BANK");
    expect(roleFromPageClassifications({ questionPages: 5, referencePages: 60, titlePages: 5, total: 70 })).toBe("PRACTICAL_REFERENCE");
  });

  it("renders a dry-run markdown report", () => {
    const r: DryRunReport = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      sourceDir: "C:/x",
      documents: [],
      totals: { documents: 1, pages: 10, questions: 2, autoVerified: 1, needsReview: 1 },
    };
    const md = renderDryRunMarkdownV2(r);
    expect(md).toContain("DRY RUN ONLY");
    expect(md).toContain("Question candidates: **2**");
  });
});
