import { describe, expect, it } from "vitest";
import {
  extractFacts, rankConcepts, buildRichSummary, buildMindMap, detectIntent, extractQuotedOrCapitalised,
  factsAbout, normaliseArabic, normaliseForCompare, similarity, deduplicate, splitSentences, hasArabic,
} from "./source-analysis";

const EN = `
The pericardium is a fibrous sac that surrounds the heart.
The pericardium protects the heart from friction and trauma.
Left ventricular hypertrophy causes reduced cardiac output.
Hypertrophy differs from hyperplasia because the cell size changes rather than the number.
Acute pericarditis is classified into three forms: serous, fibrinous and purulent.
Blood in the pericardial space is known as hemopericardium.
The renin-angiotensin system is used to maintain blood pressure.
Pulmonary congestion involves increased pressure in the pulmonary capillaries.
`;

const AR = `
الTMLب هو غشاء ج fibrous يحيط بالقلب.
TMLب pericardium is a sac that surrounds the heart.
الالتهاب الحاد التامور يسبب ألم thoracي شديد.
التهاب التامور يختلف عن التهاب الرئة في أنparsing الموضع مختلف.
TMLب ينقسم إلى نوعين: ليفي و Microsoft's.
The left ventricle uses papillary muscles to prevent regurgitation.
`;

describe("language handling", () => {
  it("detects Arabic", () => {
    expect(hasArabic("القلب")).toBe(true);
    expect(hasArabic("heart")).toBe(false);
  });

  it("normalises Arabic orthography so variants compare equal", () => {
    expect(normaliseArabic("القلــب")).toBe(normaliseArabic("القلب"));
    expect(normaliseArabic("مَرْض")).toBe(normaliseArabic("مرض"));
  });

  it("produces a stable comparison key", () => {
    expect(normaliseForCompare("The Pericardium!")).toBe(normaliseForCompare("pericardium"));
  });
});

describe("dedup", () => {
  it("scores identical text as maximal similarity", () => {
    expect(similarity("left ventricle", "left ventricle")).toBe(1);
  });

  it("scores unrelated text low", () => {
    expect(similarity("left ventricle", "pulmonary artery")).toBeLessThan(0.2);
  });

  it("removes near-duplicate items", () => {
    const items = [
      { id: 1, t: "The pericardium is a fibrous sac around the heart" },
      { id: 2, t: "The pericardium is a fibrous sac around the heart." },
      { id: 3, t: "Left ventricular hypertrophy causes reduced output" },
    ];
    const out = deduplicate(items, (i) => i.t);
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.id)).toEqual([1, 3]);
  });
});

describe("sentence splitting", () => {
  it("splits English sentences and keeps abbreviations intact", () => {
    const s = splitSentences("The heart pumps blood. It does this e.g. continuously. The lungs oxygenate blood.");
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s.some((x) => x.includes("e.g. continuously"))).toBe(true);
  });

  it("handles Arabic sentence marks", () => {
    const s = splitSentences("القلب يضخ الدم؟ نعم. الرئة تؤكسجين الدم.");
    expect(s.length).toBeGreaterThanOrEqual(2);
  });

  it("does not split a statement at an anatomical abbreviation", () => {
    const s = splitSentences(
      "Blood pumped from left side of the heart (Lt. ventricle, aorta, all tissues) to supply all tissues of the body.",
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toContain("all tissues");
  });

  it("does not split inside an unclosed bracket", () => {
    const s = splitSentences("The blood returns to the right atrium (veins and Rt. atrium).");
    expect(s).toHaveLength(1);
  });
});

describe("fact extraction from plain statements", () => {
  it("keeps a statement that matches no relation pattern", () => {
    const facts = extractFacts(
      "Oxygenated blood returns to the left atrium through the four pulmonary veins.",
    );
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.detail.toLowerCase().includes("pulmonary veins"))).toBe(true);
  });

  it("builds a whole-lecture summary from statement-only text", () => {
    const raw = [
      "Oxygenated blood returns to the left atrium through the four pulmonary veins.",
      "Deoxygenated blood enters the right atrium through the superior vena cava.",
      "The left ventricle pumps oxygenated blood into the aorta.",
      "The right ventricle pumps deoxygenated blood into the pulmonary trunk.",
      "Chambers carry deoxygenated blood.",
    ].join("\n");
    const facts = extractFacts(raw);
    expect(facts.length).toBeGreaterThanOrEqual(4);
    const summary = buildRichSummary(facts, "", "CVS");
    expect(summary.keyConcepts.length).toBeGreaterThanOrEqual(3);
    expect(summary.overview.length).toBeGreaterThan(40);
  });

  it("never turns a question into a fact", () => {
    const facts = extractFacts("Regarding the heart, which of the following is correct about valves?");
    expect(facts).toHaveLength(0);
  });

  it("never keeps an interrogative word as a concept", () => {
    const facts = extractFacts("Which of the following is not a component of the cardiovascular system?");
    expect(facts.filter((f) => /which|following|regarding/i.test(f.subject))).toHaveLength(0);
  });
});

describe("fact extraction (English)", () => {
  const facts = extractFacts(EN);

  it("extracts a definition", () => {
    const d = facts.find((f) => (f.kind === "DEFINITION" && /pericardium/i.test(f.subject)));
    expect(d).toBeTruthy();
    expect(d!.detail.toLowerCase()).toContain("fibrous sac");
  });

  it("extracts a cause/effect pair", () => {
    const c = facts.find((f) => (f.kind === "CAUSE" && /hypertrophy/i.test(f.subject)));
    expect(c).toBeTruthy();
    expect(c!.detail.toLowerCase()).toContain("cardiac output");
  });

  it("extracts a comparison with a counterpart", () => {
    const c = facts.find((f) => f.kind === "COMPARISON");
    expect(c).toBeTruthy();
    expect(c!.counterpart!.toLowerCase()).toContain("hyperplasia");
  });

  it("extracts a classification", () => {
    const c = facts.find((f) => f.kind === "CLASSIFICATION");
    expect(c).toBeTruthy();
    expect(c!.detail.toLowerCase()).toContain("serous");
  });

  it("extracts a purpose relation", () => {
    const p = facts.find((f) => f.kind === "PURPOSE");
    expect(p).toBeTruthy();
    expect(p!.detail.toLowerCase()).toContain("blood pressure");
  });

  it("never invents facts that are absent from the source", () => {
    for (const f of facts) {
      const norm = normaliseForCompare(f.sentence);
      for (const frag of [f.subject, f.detail, f.counterpart ?? ""].filter(Boolean)) {
        const firstWords = normaliseForCompare(frag).split(" ").slice(0, 2).join(" ");
        if (firstWords) expect(norm).toContain(firstWords);
      }
    }
  });
});

describe("concepts and summary", () => {
  const facts = extractFacts(EN);
  const summary = buildRichSummary(facts, "", "Cardiovascular physiology");

  it("ranks concepts by how much the lecture says about them", () => {
    const concepts = rankConcepts(facts);
    expect(concepts.length).toBeGreaterThan(1);
  });

  it("builds a structured summary with real sections", () => {
    expect(summary.overview).toBeTruthy();
    expect(summary.keyConcepts.length).toBeGreaterThan(0);
    expect(summary.keyConcepts[0].term).toBeTruthy();
    expect(summary.keyConcepts[0].meaning).toBeTruthy();
    expect(summary.comparisons.length).toBeGreaterThan(0);
    expect(summary.causes.length).toBeGreaterThan(0);
    expect(summary.classifications.length).toBeGreaterThan(0);
  });

  it("builds a hierarchical mind map", () => {
    const map = buildMindMap(facts, "Cardiovascular physiology");
    expect(map.label).toBe("Cardiovascular physiology");
    expect(map.children.length).toBeGreaterThan(0);
    expect(map.children.some((c) => c.children.length > 0)).toBe(true);
  });

  it("falls back honestly when there is no usable source", () => {
    const s = buildRichSummary([], "", "Empty lecture");
    expect(s.overview).toMatch(/too limited/i);
    expect(s.keyConcepts).toHaveLength(0);
  });
});

describe("clause fragments are not concepts", () => {
  const TABLEISH = `
    Gram negative bacteria: Composed of peptidoglycan which lies outside the cytoplasmic membrane.
    determination of: creatinine clearance is the gold standard for renal function.
    Cytoplasmic membrane: composed of phospholipids and proteins.
    Peptidoglycan: a polymer of sugars that provides cell wall rigidity.
    Based on the cell wall: Gram positive and negative bacteria differ in staining.
    There are two types of bacterial cell wall: thick and thin.
    The cytoplasmic membrane: controls transport of substances.
    In the provided test the colour changes from blue to purple.
  `;

  const facts = extractFacts(TABLEISH);
  const terms = buildRichSummary(facts, "", "Bacteria").keyConcepts.map((c) => c.term);

  it("keeps real cell structures", () => {
    expect(terms).toContain("Peptidoglycan");
    expect(terms).toContain("Cytoplasmic membrane");
  });

  it("keeps a multi-word subject whole instead of its first word", () => {
    expect(facts.some((f) => f.subject === "Gram negative bacteria")).toBe(true);
    expect(terms).not.toContain("Gram");
    expect(terms).not.toContain("Cytoplasmic");
  });

  it("drops subjects that are clause fragments", () => {
    expect(terms).not.toContain("determination of");
    expect(terms.some((t) => /^(?:Composed|Based on|There are|In the)\b/i.test(t))).toBe(false);
  });
});

describe("imperative method steps are not concepts", () => {
  const PRACTICAL = `
    Protein estimation: the biuret method measures total protein in a sample.
    Biuret reagent: an alkaline copper sulphate solution.
    Principle of the biuret method: based on the binding of copper ions to peptide bonds.
    Add a few drops of reagent to the test tube.
    Place the tube in a water bath for five minutes.
    Urinary protein: detected by the dipstick method.
  `;
  const terms = buildRichSummary(extractFacts(PRACTICAL), "", "Practical 2").keyConcepts.map((c) => c.term);

  it("keeps the named principles", () => {
    expect(terms).toContain("Principle of the biuret method");
  });

  it("does not promote a lab instruction to a concept", () => {
    expect(terms.some((t) => /^(?:Add|Place|Use|Mix|Heat|Record)\b/i.test(t))).toBe(false);
  });
});

describe("intent detection", () => {
  it("detects cause questions in both languages", () => {
    expect(detectIntent("What causes reduced cardiac output?").intent).toBe("CAUSE");
    expect(detectIntent("ما سبب ارتفاع ضغط الدم؟").intent).toBe("CAUSE");
  });

  it("detects comparison questions", () => {
    expect(detectIntent("Compare hypertrophy and hyperplasia").intent).toBe("COMPARE");
    expect(detectIntent("ما الفرق بين الاحتشاء والانصمام؟").intent).toBe("COMPARE");
  });

  it("detects definition questions", () => {
    expect(detectIntent("What is the pericardium?").intent).toBe("DEFINITION");
    expect(detectIntent("ما هو التامور؟").intent).toBe("DEFINITION");
  });

  it("detects summary and quiz requests", () => {
    expect(detectIntent("Summarize this lecture").intent).toBe("SUMMARY");
    expect(detectIntent("Quiz me please").intent).toBe("QUIZ");
  });

  it("extracts the term being asked about", () => {
    expect(extractQuotedOrCapitalised('What causes "cardiac output" reduction?')).toContain("cardiac output");
    expect(extractQuotedOrCapitalised("What is Left Ventricular Hypertrophy?")).toContain("Left Ventricular Hypertrophy");
  });
});

describe("focused answers", () => {
  const facts = extractFacts(EN);

  it("returns cause facts when asked about causes", () => {
    const { intent, focusTerms } = detectIntent("What causes reduced cardiac output?");
    const hits = factsAbout(facts, focusTerms, intent, "What causes reduced cardiac output?");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("returns the definition for a specific term", () => {
    const { intent, focusTerms } = detectIntent("What is the pericardium?");
    const hits = factsAbout(facts, focusTerms, intent, "What causes reduced cardiac output?");
    expect(hits.some((h) => h.kind === "DEFINITION")).toBe(true);
  });
});
