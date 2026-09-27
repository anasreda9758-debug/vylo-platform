import { describe, expect, it } from "vitest";
import {
  createSourceFlashcards, createSourceTutorReply, createSourceClinicalCase, evaluateSourceAnswers,
} from "./source-generators";
import { similarity } from "./source-analysis";

const CONTENT = `
The pericardium is a fibrous sac that surrounds the heart and protects it from friction.
Left ventricular hypertrophy causes reduced cardiac output and heart failure.
Hypertrophy differs from hyperplasia because the cell size changes rather than the number.
Acute pericarditis is classified into three forms: serous, fibrinous and purulent.
Blood in the pericardial space is known as hemopericardium.
The renin-angiotensin system is used to maintain systemic blood pressure.
Pulmonary congestion involves increased pressure in the pulmonary capillaries.
Papillary muscle rupture causes acute mitral regurgitation after myocardial infarction.
`;

const AR_CONTENT = `
التامور هو غشاء ليفي يحيط بالقلب ويحميه من الاحتكاك.
اعتضام البطين الأيسر يسبب نقص في ناتج القلب.
يختلف اعتضام البطين الأيسر عن التوسع الخلوي لأن حجم الخلية يتغير وليس عددها.
التهاب التامور الحاد ينقسم إلى ثلاثة أنواع: مصلي وتليفي وصديدي.
الدال في تجويف التامور يعرف باسم هيمopericardium.
نظام الرينين أنجيوتنسين يستخدم في الحفاظ على ضغط الدم.
`;

describe("flashcard quality", () => {
  const { cards } = createSourceFlashcards("Cardiovascular", CONTENT, null);

  it("generates several cards", () => {
    expect(cards.length).toBeGreaterThanOrEqual(4);
  });

  it("does not repeat the same question", () => {
    const fronts = cards.map((c) => c.front);
    for (let i = 0; i < fronts.length; i++) {
      for (let j = i + 1; j < fronts.length; j++) {
        expect(similarity(fronts[i], fronts[j])).toBeLessThan(0.6);
      }
    }
  });

  it("produces more than one card type", () => {
    const types = new Set(cards.map((c) => c.cardType));
    expect(types.size).toBeGreaterThan(1);
  });

  it("never copies the source sentence verbatim into the question", () => {
    for (const c of cards) {
      expect(CONTENT.includes(c.front)).toBe(false);
    }
  });

  it("gives every card a non-empty answer", () => {
    for (const c of cards) expect(c.back.trim().length).toBeGreaterThan(3);
  });

  it("warns honestly when the lecture has too little text", () => {
    const weak = createSourceFlashcards("Tiny", "Heart.", null);
    expect(weak.warning).toBeTruthy();
    expect(weak.warning).toMatch(/too little text/i);
    expect(weak.cards).toHaveLength(0);
  });

  it("does not warn when the lecture is rich enough", () => {
    expect(createSourceFlashcards("Cardiovascular", CONTENT, null).warning).toBeNull();
  });

  it("supports Arabic lectures instead of dropping them", () => {
    const ar = createSourceFlashcards("التامور", AR_CONTENT, null).cards;
    expect(ar.length).toBeGreaterThanOrEqual(2);
    expect(ar.some((c) => /[\u0600-\u06FF]/.test(c.front))).toBe(true);
  });
});

describe("tutor answers the actual question", () => {
  it("answers a cause question with causes, not a source dump", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "What causes reduced cardiac output?");
    expect(reply).toMatch(/hypertrophy/i);
    expect(reply.length).toBeLessThan(1200);
  });

  it("answers a definition question with a definition", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "What is the pericardium?");
    expect(reply.toLowerCase()).toMatch(/fibrous sac|pericardium/i);
  });

  it("answers a comparison question with the contrast", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "How does hypertrophy differ from hyperplasia?");
    expect(reply).toMatch(/hyperplasia/i);
    expect(reply).toMatch(/hypertrophy/i);
  });

  it("returns a structured summary when asked", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "Summarize this lecture");
    expect(reply).toMatch(/Summary/i);
    expect(reply.length).toBeGreaterThan(80);
  });

  it("does not repeat identical sentences", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "Summarize this lecture");
    const lines = reply.split("\n").map((l) => l.trim()).filter((l) => l.length > 25);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("does not dump raw source chunks verbatim", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "What is the pericardium?");
    for (const line of CONTENT.split(".").map((s) => s.trim()).filter((s) => s.length > 40)) {
      expect(reply.includes(line)).toBe(false);
    }
  });

  it("is honest when the source cannot answer", () => {
    const reply = createSourceTutorReply("Empty", "x", null, "What is quantum chromodynamics?");
    expect(reply).toMatch(/not covered|غير متوفرة/i);
  });

  it("answers an Arabic question in Arabic", () => {
    const reply = createSourceTutorReply("التامور", AR_CONTENT, null, "ما هو التامور؟");
    expect(reply).toMatch(/[\u0600-\u06FF]/);
    expect(reply).toMatch(/ليفي|التامور/);
  });
});

describe("clinical case quality", () => {
  const c = createSourceClinicalCase("Cardiovascular", CONTENT, null);

  it("produces a real scenario, not a meta instruction", () => {
    expect(c.case.length).toBeGreaterThan(40);
    expect(c.case).not.toMatch(/a student is revising/i);
  });

  it("asks specific, gradeable questions", () => {
    expect(c.questions.length).toBeGreaterThanOrEqual(2);
    for (const q of c.questions) {
      expect(q).not.toMatch(/key point \d/i);
      expect(q.length).toBeGreaterThan(10);
    }
  });

  it("has one model answer per question", () => {
    expect(c.model_answers).toHaveLength(c.questions.length);
  });

  it("refuses to invent a case from an empty lecture", () => {
    const empty = createSourceClinicalCase("Nothing", "", null);
    expect(empty.questions).toHaveLength(0);
    expect(empty.case).toMatch(/not enough source text|لا يوجد محتوى/i);
  });
});

describe("case evaluation", () => {
  it("scores a correct, well-worded answer highly", () => {
    const c = createSourceClinicalCase("Cardiovascular", CONTENT, null);
    const answers = c.model_answers.map((m) => m.split(":")[0] ?? m);
    const r = evaluateSourceAnswers(answers, c.model_answers);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.feedback).toMatch(/strong/i);
  });

  it("scores a wrong answer low with actionable feedback", () => {
    const r = evaluateSourceAnswers(["completely unrelated text about cooking"], ["Pericardium: fibrous sac"]);
    expect(r.score).toBeLessThan(40);
    expect(r.feedback.length).toBeGreaterThan(20);
  });

  it("handles an empty answer without crashing", () => {
    const r = evaluateSourceAnswers([], ["Pericardium: fibrous sac"]);
    expect(r.score).toBe(0);
    expect(r.feedback).toMatch(/no answer/i);
  });
});
