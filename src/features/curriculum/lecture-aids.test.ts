import { describe, expect, it } from "vitest";
import { getLectureAids } from "./lecture-aids";

const CONTENT = `
Cardiovascular system
❖Blood pumped from left side of the heart (Lt. ventricle, aorta, all tissues) to
supply all tissues of the body.
❖Then the blood returns back to the right atrium (veins and Rt. atrium).
The left ventricle pumps oxygenated blood into the aorta.
The right ventricle pumps deoxygenated blood into the pulmonary trunk.
Oxygenated blood returns to the left atrium through the four pulmonary veins.
Lecture: oral cavity&salivary
Learning Outcomes
Identify the different methods used in the diagnosis of viral infections.
Q6- A62-year-old man developed a flu-like syndrome with fever and sore throat.
Anatomy for Students. Elsevier.
Romanes, G. J.: Cunning hams Manual of Practical Anatomy.13th ed. London, Oxford University Press.
Snell, R.S. (2008): "Clinical Anatomy by Regions". 8th ed.
Anatomy department
`;

const CLEAN_SUMMARY = {
  overview: "The pericardium is the fibrous sac that surrounds the heart.",
  keyPoints: ["The pericardium protects the heart from friction."],
  clinicalPearls: [],
};
const CLEAN_MAP = {
  label: "CVS",
  children: [{ label: "Pericardium", detail: "fibrous sac around the heart", children: [] }],
};

const aids = (over: Partial<Parameters<typeof getLectureAids>[0]> = {}) =>
  getLectureAids({
    title: "CVS",
    content: CONTENT,
    summaryJson: null,
    mindmapJson: null,
    ...over,
  });

describe("stored aids", () => {
  it("keeps clean stored aids untouched", () => {
    const res = aids({ summaryJson: CLEAN_SUMMARY, mindmapJson: CLEAN_MAP });
    expect(res.derived).toBe(false);
    expect(res.summary).toBeNull();
    expect(res.mindMap?.label).toBe("CVS");
  });

  it("rebuilds a stored summary that carries source noise", () => {
    const res = aids({
      summaryJson: {
        overview: "This lecture focuses on Anatomy department, Definition, Anatomy for Students. Elsevier.",
        keyPoints: ["Romanes", "Snell", "Anatomy department"],
        clinicalPearls: [],
      },
      mindmapJson: CLEAN_MAP,
    });
    expect(res.derived).toBe(true);
    expect(res.summary).not.toBeNull();
    const text = JSON.stringify(res.summary);
    expect(text).not.toMatch(/Anatomy department|Anatomy for Students|Romanes|Snell/);
    expect(text.toLowerCase()).toContain("heart");
  });

  it("rebuilds a stored mind map that carries a bare section label", () => {
    const res = aids({
      summaryJson: CLEAN_SUMMARY,
      mindmapJson: { label: "Key concepts", children: [{ label: "NASAL CAVITY", children: [] }] },
    });
    expect(res.derived).toBe(true);
    const labels = JSON.stringify(res.mindMap);
    expect(labels).not.toMatch(/Key concepts|NASAL CAVITY/);
  });

  it("keeps a clean mind map when only the summary is dirty", () => {
    const res = aids({
      summaryJson: { overview: "Ground Rules", keyPoints: ["ILOs"], clinicalPearls: [] },
      mindmapJson: CLEAN_MAP,
    });
    expect(res.derived).toBe(true);
    expect(res.mindMap?.label).toBe("CVS");
    expect(res.summary).not.toBeNull();
  });

  it("rejects a stored overview that only lists the slide titles", () => {
    const res = aids({
      summaryJson: {
        overview: "This lecture focuses on (1) URINE TESTS, (2) BLOOD TESTS, (4) RADIOLOGICAL TESTS.",
        keyPoints: ["Urine tests"],
        clinicalPearls: [],
      },
      mindmapJson: CLEAN_MAP,
    });
    expect(res.derived).toBe(true);
    expect(res.summary).not.toBeNull();
    expect(res.summary!.overview).not.toMatch(/This lecture focuses on/);
  });

  it("never renders a rejected stored aid when there is nothing to rebuild from", () => {
    const res = aids({
      content: "Lecture 3",
      summaryJson: { overview: "Anatomy department", keyPoints: ["Romanes"], clinicalPearls: [] },
      mindmapJson: CLEAN_MAP,
    });
    expect(res.derived).toBe(true);
    expect(res.summary).toBeNull();
    expect(res.mindMap?.label).toBe("CVS");
  });
});

describe("derived content", () => {
  it("keeps no reference, metadata, objective or quiz text", () => {
    const res = aids();
    expect(res.derived).toBe(true);
    const text = JSON.stringify(res);
    expect(text).not.toMatch(/Romanes|Snell|Elsevier|Oxford University Press|Anatomy department|oral cavity|Learning Outcomes|Identify the different|A62-year-old/);
  });

  it("produces whole-sentence facts rather than fragments", () => {
    const res = aids();
    const detail = res.summary!.keyConcepts.map((c) => c.meaning).join(" ");
    expect(detail).toContain("supply all tissues of the body");
    expect(detail).not.toMatch(/\(Lt$/);
  });

  it("builds a mind map of real concepts", () => {
    const res = aids();
    const labels = (res.mindMap?.children ?? []).map((c) => c.label.toLowerCase());
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(labels.join(" ")).toMatch(/ventricle|blood|atrium|heart|valve/);
  });

  it("returns nothing for a lecture with no study content", () => {
    const res = getLectureAids({
      title: "Empty",
      content: "Slide 1\nAll rights reserved",
      summaryJson: null,
      mindmapJson: null,
    });
    expect(res.summary).toBeNull();
    expect(res.mindMap).toBeNull();
  });
});