import { describe, expect, it } from "vitest";
import {
  classifyLine,
  cleanLine,
  classifyLines,
  cleanSourceText,
  cleanedSource,
  deduplicateLines,
  filterContentLines,
  isNonStudyText,
  looksLikeReference,
  normaliseForCompare,
  reconstructCleanText,
  rewrapLines,
  stripCitation,
} from "./source-cleaner";
import { normaliseArabic } from "./source-analysis";

/* ------------------------------------------------------------------ */
/* the exact lines the owner reported                                  */
/* ------------------------------------------------------------------ */

const BIBLIOGRAPHY_LINES = [
  "Romanes, G. J.: Cunningham’s Manual of Practical Anatomy, 13th ed., London, Oxford University Press, New York, Bombay.",
  "Snell, R.S. (2008): Clinical Anatomy by Regions, 8th ed.",
  "Moore, K. L.; Dalley, A. F. and Agur, A. M. R. (2010)",
  "Anatomy for Students. Elsevier.",
  "Devi, V.S. (2018):“Inderbir Singh’s Human Embryology”.11th ed. The Health Sciences Publisher, New Delhi, London Panama.",
  "Drake, R. A. Wayne Vogl, W. and Mitchell, A. (2017): Gray's Anatomy for Students. Elsevier.",
  "Snell, R.S. (2008): “Clinical Anatomy by Regions”. 8th ed. Lippincott Williams& Wilkins. Philadelphia, New York, London, Hong Kong, Sydney, Tokyo. P. 253",
  "Romanes, G. J.: Cunning hams Manual of Practical Anatomy.13th ed. London, Oxford University Press. New York, Bombay.",
  "Moore, K. L.; Dalley, A. F. and Agur, A. M. R. (2010): Clinically Oriented Anatomy.6th Edition, Lippincott Williams & Wilkins, Philadelphia.",
  "Lippincott Williams& Wilkins. Philadelphia, New York, London,",
  "The Health Sciences Publisher, New Delhi, London Panama.",
];

const ADMINISTRATIVE_LINES = [
  "Anatomy department",
  "Horus University in Egypt",
  "Human Anatomy & Embryology Dept.",
  "Staff Members oF",
  "BY",
  "Learning",
  "Outcomes",
  "By the end of the lecture, the students will be able to:",
  "Know the Components of cardiovascular system",
  "Compare between arteries & veins",
  "Ientify Types of blood circulations",
  "Knowledge of the Heart valves & their site",
  "Definition",
  "Prepared by: Dr. Ahmed",
  "Email: prof@university.edu",
  "All rights reserved",
  "Slide 5/50",
];

/** Real study content that must survive filtering. */
const MEDICAL_LINES = [
  "Cardiovascular system consists of the heart and the blood vessels.",
  "The heart acts as a pump that drives blood through the circulation.",
  "The atria are separated by the interatrial septum.",
  "Types of circulation are systemic, pulmonary and portal.",
  "Pulmonary circulation carries deoxygenated blood to the lungs.",
  "Systemic circulation supplies oxygenated blood to all body tissues.",
  "The left ventricle has a thicker wall than the right ventricle.",
  "The tricuspid valve between the Rt. atrium and Rt. ventricle.",
  "The liver removes toxins and stores sugars.",
  "The pericardium is a fibrous sac surrounding the heart.",
  "The ventricles are the main pumping chambers of the heart.",
  "The portal vein carries blood from the intestine to the liver.",
];

describe("source-cleaner: bibliography detection", () => {
  it.each(BIBLIOGRAPHY_LINES)("classifies as REFERENCE: %s", (line) => {
    expect(classifyLine(line)).toBe("REFERENCE");
    expect(isNonStudyText(line)).toBe(true);
  });

  it("detects generic citations, not only the books we were given", () => {
    // A completely different book, publisher, city set and year.
    expect(looksLikeReference("Hammer, G. D. (2019): Textbook of Histology, 3rd ed. Elsevier, London, New York.")).toBe(true);
    expect(looksLikeReference("Widmaier, K. J. and Raffa, K. D.: Pharmacology, 9th ed, McGraw-Hill, Boston.")).toBe(true);
    expect(looksLikeReference("Springer-Verlag, Berlin, 2004")).toBe(true);
    expect(looksLikeReference("ISBN 978-3-16-148410-0")).toBe(true);
    expect(looksLikeReference("doi:10.1016/j.heart.2019.04.001")).toBe(true);
    // A publisher plus a book title and nothing else.
    expect(looksLikeReference("Gray's Anatomy for Students. Elsevier.")).toBe(true);
  });

  it("keeps medical sentences that merely mention a year or a number", () => {
    expect(looksLikeReference("The fetal heart begins beating at about 22 days of gestation.")).toBe(false);
    expect(looksLikeReference("There are 3 types of circulation.")).toBe(false);
    expect(classifyLine("The fetal heart begins beating at about 22 days of gestation.")).toBe("MEDICAL_CONTENT");
  });

  it("treats everything under a References heading as non-study", () => {
    const raw = [
      "References:",
      "• Romanes, G. J.: Cunningham’s Manual of Practical Anatomy, 13th ed., London, Oxford University Press.",
      "• Snell, R.S. (2008): Clinical Anatomy by Regions, 8th ed.",
      "• Snell, R.S. (2010): Clinical Anatomy by Regions, 9th ed.",
    ].join("\n");
    const result = cleanSourceText(raw);
    expect(result.referenceLines.length).toBe(4);
    expect(result.contentLines.length).toBe(0);
    expect(cleanedSource(raw)).toBe("");
  });

  it.each([
    "References",
    "REFERENCES:",
    "Bibliography",
    "Recommended reading",
    "Further reading",
    "Recommended books",
    "Works cited",
    "المراجع",
  ])("recognises the references heading %s", (heading) => {
    const result = cleanSourceText([heading, "Moore, K. L. (2010): Clinically Oriented Anatomy, 6th ed."].join("\n"));
    expect(result.contentLines.length).toBe(0);
    expect(result.referenceLines.length).toBe(2);
  });

  it("resumes content at a real section after references", () => {
    const raw = [
      "References",
      "Snell, R.S. (2008): Clinical Anatomy by Regions, 8th ed.",
      "",
      "The diaphragm",
      "The diaphragm is the main muscle of respiration.",
    ].join("\n");
    const result = cleanSourceText(raw);
    const kept = result.contentLines.map((l) => l.cleaned).join(" ");
    expect(kept).toContain("diaphragm is the main muscle");
    expect(kept).not.toContain("Snell");
  });
});

describe("source-cleaner: metadata, objectives and furniture", () => {
  it.each([
    ["Anatomy department", "METADATA"],
    ["Horus University in Egypt", "METADATA"],
    ["Human Anatomy & Embryology Dept.", "METADATA"],
    ["Staff Members oF", "METADATA"],
    ["BY", "METADATA"],
    ["Learning", "OBJECTIVE"],
    ["Outcomes", "OBJECTIVE"],
    ["By the end of the lecture, the students will be able to:", "OBJECTIVE"],
    ["Know the Components of cardiovascular system", "OBJECTIVE"],
    ["Compare between arteries & veins", "OBJECTIVE"],
    ["Ientify Types of blood circulations", "OBJECTIVE"],
    ["Knowledge of the Heart valves & their site", "OBJECTIVE"],
    ["Definition", "OBJECTIVE"],
    ["Prepared by: Dr. Smith", "METADATA"],
    ["إعداد: د. أحمد", "METADATA"],
    ["Page 5", "FOOTER"],
    ["5/50", "FOOTER"],
    ["© 2024 University", "FOOTER"],
    ["All rights reserved", "FOOTER"],
    ["Slide 5/50", "NOISE"],
    ["LEAVE ME ALONE", "NOISE"],
    ["Module 1", "HEADER"],
    ["I- Heart", "HEADER"],
  ])("classifies %s as %s", (line, expected) => {
    expect(classifyLine(line)).toBe(expected);
    expect(isNonStudyText(line)).toBe(expected !== "MEDICAL_CONTENT" && expected !== "UNKNOWN");
  });

  it("never lets a non-study line reach the study text", () => {
    const raw = [...ADMINISTRATIVE_LINES, ...MEDICAL_LINES].join("\n");
    const kept = cleanedSource(raw);
    // Distinctive markers only: "BY" and "Learning" are too short to assert on,
    // since they occur inside ordinary medical words.
    for (const bad of [
      "Anatomy department",
      "Horus University",
      "Human Anatomy",
      "Staff Members",
      "students will be able",
      "Know the Components",
      "Compare between",
      "Ientify",
      "Knowledge of the Heart",
      "Prepared by",
      "prof@university.edu",
      "All rights reserved",
      "Slide 5/50",
    ]) {
      expect(kept).not.toContain(bad);
    }
    expect(kept).toContain("interatrial septum");
  });
});

describe("source-cleaner: real medical content survives", () => {
  it.each(MEDICAL_LINES)("keeps %s as medical content", (line) => {
    expect(classifyLine(line)).toBe("MEDICAL_CONTENT");
    expect(isNonStudyText(line)).toBe(false);
  });

  it("keeps real content in a mixed document", () => {
    const raw = [
      "Anatomy department",
      "Human Anatomy & Embryology Dept.",
      "Horus University in Egypt",
      "Learning",
      "Outcomes",
      "By the end of the lecture, the students will be able to:",
      "Know the Components of cardiovascular system",
      "Definition",
      "The cardiovascular system consists of the heart and the blood vessels.",
      "The heart acts as a pump.",
      "The atria are separated by the interatrial septum.",
      "References:",
      "Romanes, G. J.: Cunningham’s Manual of Practical Anatomy, 13th ed., London, Oxford University Press, New York, Bombay.",
      "Snell, R.S. (2008): Clinical Anatomy by Regions, 8th ed.",
    ].join("\n");

    const result = cleanSourceText(raw);
    const kept = cleanedSource(raw);

    expect(kept).toContain("The cardiovascular system consists of the heart and the blood vessels.");
    expect(kept).toContain("The heart acts as a pump.");
    expect(kept).toContain("The atria are separated by the interatrial septum.");

    for (const bad of ["Romanes", "Cunningham", "Snell", "Elsevier", "Oxford University Press", "Anatomy department", "Human Anatomy", "Horus University", "Learning", "Outcomes", "Definition"]) {
      expect(kept).not.toContain(bad);
    }

    expect(result.stats.reference).toBe(3);
    // Learning, Outcomes, the lead-in, "Know the Components", "Definition".
    expect(result.stats.objective).toBe(5);
    expect(result.stats.metadata).toBe(3);
    expect(result.stats.medical).toBe(3);
  });

  it("keeps numbered medical statements that are not headings", () => {
    const raw = [
      "1. The tricuspid valve between the Rt. atrium and Rt. ventricle.",
      "2. The bicuspid valve (Mitral valve) between the left atrium and left ventricle.",
      "1) Arteries: carry oxygenated blood from heart to tissues.",
    ].join("\n");
    const kept = cleanedSource(raw);
    expect(kept).toContain("tricuspid valve");
    expect(kept).toContain("bicuspid valve");
    expect(kept).toContain("Arteries");
  });

  it("keeps a lecture whose sentences are short and unlabelled", () => {
    const raw = ["The lungs oxygenate blood.", "The kidneys filter plasma.", "The spleen stores blood."].join("\n");
    expect(cleanedSource(raw)).toContain("lungs oxygenate blood");
  });

  it("keeps clinical vocabulary no lexicon lists (over-filtering guard)", () => {
    // "pericarditis", "hypertrophy" and "hyperplasia" are clinical morphology,
    // not words in any fixed vocabulary list, and must never be dropped.
    const raw = [
      "Acute pericarditis is classified into three forms: serous, fibrinous and purulent.",
      "Hypertrophy differs from hyperplasia because the cell size changes rather than the number.",
    ].join("\n");
    const kept = cleanedSource(raw);
    expect(kept).toContain("pericarditis");
    expect(kept).toContain("hyperplasia");
  });

  it("keeps a substantive statement whose vocabulary is unknown", () => {
    const kept = cleanedSource("The widget is attached to the gimbal by a torsion spring.");
    expect(kept).toContain("torsion spring");
  });

  it("keeps Arabic medical statements", () => {
    const raw = [
      "التامور هو غشاء ليفي يحيط بالقلب ويحميه من الاحتكاك.",
      "التهاب التامور الحاد ينقسم إلى ثلاثة أنواع: مصلي وتليفي وصديدي.",
      "نظام الرينين أنجيوتنسين يستخدم في الحفاظ على ضغط الدم.",
    ].join("\n");
    const kept = cleanedSource(raw);
    expect(kept).toContain("ليفي");
    expect(kept).toContain("ينقسم");
    expect(kept).toContain("ضغط");
  });

  it("does not read the verb 'ينقسم' (is divided) as a department line", () => {
    // "قسم" is a substring of "ينقسم"; metadata matching needs a word start.
    expect(classifyLine("التهاب التامور الحاد ينقسم إلى ثلاثة أنواع.")).toBe("MEDICAL_CONTENT");
    expect(classifyLine("قسم التشريح")).toBe("METADATA");
  });

  it("never falls back to a stray heading when no medical line is found", () => {
    const raw = ["Valves of the Heart", "Unknown Areas", "References", "Snell, R.S. (2008): Clinical Anatomy by Regions."].join(
      "\n",
    );
    expect(cleanedSource(raw)).toBe("");
  });
});

describe("source-cleaner: citation stripping", () => {
  it("removes a citation suffix but keeps the medical claim", () => {
    expect(stripCitation("The heart acts as a pump (Snell, 2008).")).toBe("The heart acts as a pump.");
    expect(stripCitation("The atria are separated by the septum (Gray's Anatomy for Students, 2nd ed., 2017).")).toBe(
      "The atria are separated by the septum.",
    );
    expect(stripCitation("The liver removes toxins (Moore et al., 2010)")).toBe("The liver removes toxins");
    expect(stripCitation("Pericardial effusion — Reference: Elsevier")).toBe("Pericardial effusion");
  });

  it("never strips a genuine parenthesis", () => {
    expect(stripCitation("It has 2 thin wall atria (Rt. & Lt.).")).toBe("It has 2 thin wall atria (Rt. & Lt.).");
    expect(stripCitation("The ventricle (left) has a thick wall.")).toBe("The ventricle (left) has a thick wall.");
  });
});

describe("source-cleaner: classification basics", () => {
  it("detects emails, phones and copyright", () => {
    // A line that is only an email address cleans away completely (noise);
    // a contact detail inside a line is administrative metadata.
    expect(classifyLine("professor@university.edu")).toBe("NOISE");
    expect(classifyLine("Call 555-123-4567")).toBe("METADATA");
    expect(classifyLine("© 2024 All rights reserved")).toBe("FOOTER");
    expect(classifyLine("جميع الحقوق محفوظة")).toBe("FOOTER");
  });

  it("treats bare punctuation as noise", () => {
    expect(classifyLine(".")).toBe("NOISE");
    expect(classifyLine("•")).toBe("NOISE");
    expect(classifyLine("-----")).toBe("NOISE");
  });

  it("classifies real content as MEDICAL_CONTENT or UNKNOWN", () => {
    expect(classifyLine("The pericardium is a fibrous sac.")).toBe("MEDICAL_CONTENT");
    expect(classifyLine("القلب يضخ الدم إلى الجسم.")).toBe("MEDICAL_CONTENT");
    expect(classifyLine("Some remark without medical terms.")).toBe("UNKNOWN");
  });
});

describe("source-cleaner: line cleaning", () => {
  it("removes emails, phones and boilerplate", () => {
    expect(cleanLine("Contact: prof@university.edu")).toBe("Contact:");
    expect(cleanLine("Call +1-555-123-4567")).toBe("Call");
    expect(cleanLine("© 2024 University")).toBe("");
    expect(cleanLine("  Hello    World  ")).toBe("Hello World");
  });

  it("removes 'prepared by' credit lines", () => {
    expect(cleanLine("Prepared by: Dr. Smith")).toBe("Dr. Smith");
    expect(cleanLine("إعداد: د. أحمد")).toBe("د. أحمد");
  });

  it("preserves legitimate medical content", () => {
    const text = "The pericardium is a fibrous sac surrounding the heart.";
    expect(cleanLine(text)).toContain("pericardium");
  });
});

describe("source-cleaner: pipeline", () => {
  it("classifies, filters and counts", () => {
    const raw = [
      "Prepared by: Dr. Ahmed",
      "The pericardium is a fibrous sac surrounding the heart.",
      "LEAVE ME ALONE",
      "The pericardium protects the heart from friction.",
      "Slide 5/50",
      "© 2024 All rights reserved",
    ].join("\n");
    const result = cleanSourceText(raw);

    expect(result.stats.total).toBeGreaterThan(0);
    expect(result.contentLines.length).toBeGreaterThan(0);
    expect(result.metadataLines.length).toBeGreaterThan(0);
    expect(result.noiseLines.length).toBeGreaterThan(0);

    const all = result.contentLines.map((c) => c.cleaned).join(" ");
    expect(all).not.toContain("LEAVE ME ALONE");
    expect(all).not.toContain("@");
    expect(all).not.toContain("©");
    expect(all).not.toContain("Slide 5");
    expect(all).toContain("pericardium");
  });

  it("treats a repeated bare slide title as a heading, not study content", () => {
    const raw = ["Cardiovascular system", "Cardiovascular system", "Cardiovascular System"].join("\n");
    const result = cleanSourceText(raw);
    // A title with no predicate says nothing about the subject; it is kept once
    // as a heading for the mind map and never as a key concept.
    expect(result.contentLines.length).toBe(0);
    expect(result.headings).toEqual(["Cardiovascular system"]);
  });

  it("drops a line that only repeats the lecture title", () => {
    const raw = ["CVS", "The heart acts as a pump."].join("\n");
    const result = cleanSourceText(raw, { title: "CVS" });
    const kept = result.contentLines.map((c) => c.cleaned).join(" ");
    expect(kept).not.toContain("CVS");
    expect(kept).toContain("heart acts as a pump");
  });

  it("extracts clean headings for the mind map", () => {
    const raw = [
      "I- Heart",
      "II- Blood Vessels",
      "Valves of the Heart",
      "1. Which of the following is correct about veins?",
      "Definition",
    ].join("\n");
    const result = cleanSourceText(raw);
    expect(result.headings).toContain("Heart");
    expect(result.headings).toContain("Blood Vessels");
    expect(result.headings.some((h) => h.includes("Which of the following"))).toBe(false);
    expect(result.headings).not.toContain("Definition");
  });

  it("deduplicates semantically similar lines", () => {
    const lines = [
      { raw: "The heart pumps blood.", class: "MEDICAL_CONTENT" as const, cleaned: "The heart pumps blood.", norm: "heart pumps blood" },
      { raw: "The heart pumps blood.", class: "MEDICAL_CONTENT" as const, cleaned: "The heart pumps blood.", norm: "heart pumps blood" },
      { raw: "The heart pumps blood efficiently.", class: "MEDICAL_CONTENT" as const, cleaned: "The heart pumps blood efficiently.", norm: "heart pumps blood efficiently" },
    ];
    expect(deduplicateLines(lines).length).toBe(2);
  });

  it("filterContentLines keeps only study classes", () => {
    const classified = classifyLines(["Anatomy department", "The heart acts as a pump."].join("\n"));
    const kept = filterContentLines(classified);
    expect(kept.every((c) => c.class === "MEDICAL_CONTENT" || c.class === "UNKNOWN")).toBe(true);
    expect(kept.some((c) => c.cleaned.includes("Anatomy department"))).toBe(false);
  });

  it("reconstructCleanText returns usable text", () => {
    const result = cleanSourceText(["The pericardium is a fibrous sac.", "The heart pumps blood."].join("\n"));
    const text = reconstructCleanText(result);
    expect(text).toContain("pericardium");
    expect(text).toContain("heart");
  });

  it("handles Arabic content correctly", () => {
    const raw = ["إعداد: د. أحمد", "التامور هو كيس ليفي يحيط بالقلب.", "جميع الحقوق محفوظة"].join("\n");
    const result = cleanSourceText(raw);
    const all = result.contentLines.map((c) => c.cleaned).join(" ");
    expect(all).toContain("التامور");
    expect(all).toContain("قلب");
    expect(all).not.toContain("إعداد");
    expect(all).not.toContain("الحقوق محفوظة");
  });
});

describe("line re-wrapping", () => {
  it("rejoins a statement that a PDF extractor split mid-sentence", () => {
    const out = rewrapLines([
      "❖Blood pumped from left side of the heart (Lt. ventricle, aorta, all tissues) to",
      "supply all tissues of the body.",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("to supply all tissues of the body");
  });

  it("keeps a new bullet and a new sentence on their own lines", () => {
    const out = rewrapLines([
      "The heart is a muscular pump",
      "It beats about 100000 times per day.",
      "1) The systemic circulation",
    ]);
    expect(out).toHaveLength(3);
  });

  it("rejoins a heading that wrapped across two slide lines", () => {
    const out = rewrapLines(["Right atrium (RA) &", "blood returning from the body"]);
    expect(out).toEqual(["Right atrium (RA) & blood returning from the body"]);
  });

  it("does not absorb a following heading into the previous line", () => {
    const out = rewrapLines(["The pericardium is a double-walled sac", "Layers of the heart"]);
    expect(out).toHaveLength(2);
  });

  it("lets the cleaner work on whole statements", () => {
    const raw = [
      "❖Blood pumped from left side of the heart (Lt. ventricle, aorta, all tissues) to",
      "supply all tissues of the body.",
    ].join("\n");
    const all = cleanSourceText(raw).contentLines.map((c) => c.cleaned).join(" ");
    expect(all).toContain("to supply all tissues of the body");
  });
});

describe("similarity and normalisation", () => {
  it("normalises Arabic text consistently", () => {
    expect(normaliseArabic("القلــب")).toBe(normaliseArabic("القلب"));
    expect(normaliseArabic("مَرْض")).toBe(normaliseArabic("مرض"));
  });

  it("normalises for comparison", () => {
    expect(normaliseForCompare("The Pericardium!")).toBe("pericardium");
    expect(normaliseForCompare("القلب")).toBe(normaliseArabic("القلب"));
  });
});
