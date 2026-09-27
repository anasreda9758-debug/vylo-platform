import { describe, expect, it } from "vitest";
import { createSourceFlashcards, createSourceTutorReply, createSourceClinicalCase } from "./source-generators";
import { getLectureAids } from "@/features/curriculum/lecture-aids";

const NOISY_CONTENT = `
Prepared by: Dr. Ahmed Hassan
Assistant professor of pathology, Mansoura university
Contact: dr.ahmed@university.edu  |  +20-100-123-4567
© 2025 Mansoura University. All rights reserved.
Slide 5/50
LEAVE ME ALONE
The pericardium is a fibrous sac that surrounds the heart and protects it from friction.
Left ventricular hypertrophy causes reduced cardiac output and heart failure.
Hypertrophy differs from hyperplasia because the cell size changes rather than the number.
Acute pericarditis is classified into three forms: serous, fibrinous and purulent.
Blood in the pericardial space is known as hemopericardium.
Page 12
`;

const noiseTokens = (text: string): string[] => {
  const hits: string[] = [];
  if (/[@]/.test(text)) hits.push("email");
  if (/Prepared by/i.test(text)) hits.push("prepared-by");
  if (/assistant professor|Mansoura university/i.test(text)) hits.push("affiliation");
  if (/©|all rights reserved/i.test(text)) hits.push("copyright");
  if (/Slide 5|Page 12|LEAVE ME ALONE/i.test(text)) hits.push("boilerplate");
  if (/\+?20[\-\s]?100/i.test(text)) hits.push("phone");
  return hits;
};

describe("source-noise sanitisation integration", () => {
  it("flashcards never contain lecturer metadata or boilerplate", () => {
    const { cards } = createSourceFlashcards("Cardiovascular", NOISY_CONTENT, null);
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const c of cards) {
      expect(noiseTokens(`${c.front} ${c.back}`)).toEqual([]);
    }
  });

  it("flashcards still carry the real lecture content", () => {
    const { cards } = createSourceFlashcards("Cardiovascular", NOISY_CONTENT, null);
    const joined = cards.map((c) => `${c.front} ${c.back}`).join(" ");
    expect(joined).toMatch(/pericardium/i);
  });

  it("tutor replies never echo lecturer metadata", () => {
    const reply = createSourceTutorReply(
      "Cardiovascular",
      NOISY_CONTENT,
      null,
      "What causes reduced cardiac output?",
    );
    expect(noiseTokens(reply)).toEqual([]);
  });

  it("tutor stays grounded in the real content", () => {
    const reply = createSourceTutorReply("Cardiovascular", NOISY_CONTENT, null, "What is the pericardium?");
    expect(reply).toMatch(/pericardium/i);
  });

  it("clinical cases never contain editorial noise", () => {
    const c = createSourceClinicalCase("Cardiovascular", NOISY_CONTENT, null);
    expect(noiseTokens(c.case)).toEqual([]);
    for (const q of c.questions) expect(noiseTokens(q)).toEqual([]);
  });

  it("derived summary and mind map remain clean and grounded", () => {
    const aids = getLectureAids({
      title: "Cardiovascular",
      content: NOISY_CONTENT,
      summaryJson: null,
      mindmapJson: null,
    });
    expect(aids.derived).toBe(true);
    expect(aids.summary).not.toBeNull();
    expect(aids.mindMap).not.toBeNull();

    const text = [aids.summary?.overview ?? "", ...(aids.summary?.keyConcepts.map((k) => k.meaning) ?? [])].join(" ");
    expect(noiseTokens(text)).toEqual([]);
    expect(text.toLowerCase()).toContain("pericardium");
  });

  it("pure noise lectures produce no derived aids instead of nonsense", () => {
    const aids = getLectureAids({
      title: "Noise only",
      content: "Prepared by Dr. X\n© 2025. All rights reserved.\nSlide 1/10\nLEAVE ME ALONE\n",
      summaryJson: null,
      mindmapJson: null,
    });
    expect(aids.derived).toBe(false);
    expect(aids.summary).toBeNull();
  });
});