import { describe, expect, it } from "vitest";
import {
  classifyLine,
  cleanLine,
  classifyLines,
  deduplicateLines,
  cleanSourceText,
  reconstructCleanText,
  normaliseForCompare,
} from "./source-cleaner";
import { normaliseArabic } from "./source-analysis";

describe("source-cleaner: line classification", () => {
  it("detects email addresses as noise", () => {
    expect(classifyLine("professor@university.edu")).toBe("NOISE");
    expect(classifyLine("contact: prof@university.edu")).toBe("NOISE");
  });

  it("detects phone numbers as noise", () => {
    expect(classifyLine("+1-555-123-4567")).toBe("NOISE");
    expect(classifyLine("Call 555-123-4567")).toBe("NOISE");
  });

  it("detects copyright lines as noise/footer", () => {
    expect(classifyLine("© 2024 University")).toBe("FOOTER");
    expect(classifyLine("All rights reserved")).toBe("NOISE");
    expect(classifyLine("© 2024 All rights reserved")).toBe("FOOTER");
  });

  it("detects metadata lines", () => {
    expect(classifyLine("Prepared by: Dr. Smith")).toBe("METADATA");
    expect(classifyLine("Presented by: Dr. Jones")).toBe("METADATA");
    expect(classifyLine("Lecturer: Prof. Smith")).toBe("METADATA");
    expect(classifyLine("إعداد: د. أحمد")).toBe("METADATA");
  });

  it("detects slide numbers as noise", () => {
    expect(classifyLine("Slide 5")).toBe("NOISE");
    expect(classifyLine("Slide 5/50")).toBe("NOISE");
    expect(classifyLine("الشريحة 5")).toBe("NOISE");
  });

  it("detects copyright footers", () => {
    expect(classifyLine("© 2024 All rights reserved")).toBe("FOOTER");
    expect(classifyLine("All rights reserved")).toBe("NOISE");
    expect(classifyLine("جميع الحقوق محفوظة")).toBe("FOOTER");
  });

  it("detects slide numbers as noise", () => {
    expect(classifyLine("Slide 5/50")).toBe("NOISE");
    expect(classifyLine("الشريحة 5")).toBe("NOISE");
  });

  it("detects editorial noise", () => {
    expect(classifyLine("LEAVE ME ALONE")).toBe("NOISE");
    expect(classifyLine("DELETE THIS")).toBe("NOISE");
    expect(classifyLine("TODO: fix this")).toBe("NOISE");
  });

  it("identifies headers", () => {
    expect(classifyLine("Module 1")).toBe("HEADER");
    expect(classifyLine("Lecture 5")).toBe("HEADER");
    expect(classifyLine("Chapter 3")).toBe("HEADER");
    expect(classifyLine("موديول 1")).toBe("HEADER");
  });

  it("identifies footers", () => {
    expect(classifyLine("Page 5")).toBe("FOOTER");
    expect(classifyLine("5/50")).toBe("FOOTER");
  });

  it("classifies real content as CONTENT or UNKNOWN", () => {
    expect(classifyLine("The pericardium is a fibrous sac.")).toMatch(/CONTENT|UNKNOWN/);
    expect(classifyLine("القلب يضخ الدم إلى الجسم.")).toMatch(/CONTENT|UNKNOWN/);
  });
});

describe("source-cleaner: line cleaning", () => {
  it("removes email addresses", () => {
    expect(cleanLine("Contact: prof@university.edu")).toBe("Contact:");
  });

  it("removes phone numbers", () => {
    expect(cleanLine("Call +1-555-123-4567")).toBe("Call");
  });

  it("removes copyright text", () => {
    expect(cleanLine("© 2024 University. All rights reserved.")).toBe("");
    expect(cleanLine("All rights reserved.")).toBe("");
    expect(cleanLine("© 2024 University")).toBe("");
  });

  it("removes 'prepared by' and similar", () => {
    expect(cleanLine("Prepared by: Dr. Smith")).toBe("Dr. Smith");
    expect(cleanLine("Presented by: Dr. Jones")).toBe("Dr. Jones");
    expect(cleanLine("إعداد: د. أحمد")).toBe("د. أحمد");
  });

  it("removes copyright text", () => {
    expect(cleanLine("© 2024 All rights reserved")).toBe("");
    expect(cleanLine("جميع الحقوق محفوظة")).toBe("");
  });

  it("removes editorial noise", () => {
    expect(cleanLine("LEAVE ME ALONE")).toBe("");
    expect(cleanLine("DELETE THIS")).toBe("");
    expect(cleanLine("TODO: fix this")).toBe("");
  });

  it("removes slide numbers", () => {
    expect(cleanLine("Slide 5/50")).toBe("");
    expect(cleanLine("الشريحة 5")).toBe("");
  });

  it("normalises whitespace", () => {
    expect(cleanLine("  Hello    World  ")).toBe("Hello World");
  });

  it("preserves legitimate medical content", () => {
    const text = "The pericardium is a fibrous sac surrounding the heart.";
    expect(cleanLine(text)).toContain("pericardium");
    expect(cleanLine(text)).toContain("fibrous");
  });
});

describe("source-cleaner: line classification and filtering", () => {
  it("classifies all lines and filters content", () => {
    const text = `
      Prepared by: Dr. Smith
      Email: prof@university.edu
      The pericardium is a fibrous sac.
      LEAVE ME ALONE
      Slide 5/50
      The pericardium protects the heart.
    `;
    const classified = classifyLines(text);
    const content = classified.filter((c) => c.class === "CONTENT" || c.class === "UNKNOWN");
    
    expect(content.length).toBeGreaterThan(0);
    expect(content.some((c) => c.raw.includes("pericardium"))).toBe(true);
    expect(content.some((c) => c.raw.includes("LEAVE ME ALONE"))).toBe(false);
  });

  it("deduplicates semantically similar lines", () => {
    const lines = [
      { raw: "The heart pumps blood.", class: "CONTENT" as const, norm: "heart pumps blood" },
      { raw: "The heart pumps blood.", class: "CONTENT" as const, norm: "heart pumps blood" },
      { raw: "The heart pumps blood efficiently.", class: "CONTENT" as const, norm: "heart pumps blood efficiently" },
    ];
    const result = deduplicateLines(lines);
    expect(result.length).toBe(2); // first two are duplicates
  });

  it("full pipeline: cleanSourceText", () => {
    const raw = `
      Prepared by: Dr. Ahmed
      Email: dr@university.edu
      The pericardium is a fibrous sac surrounding the heart.
      LEAVE ME ALONE
      The pericardium protects the heart from friction.
      Slide 5/50
      © 2024 All rights reserved
    `;
    const result = cleanSourceText(raw);
    
    expect(result.stats.total).toBeGreaterThan(0);
    expect(result.contentLines.length).toBeGreaterThan(0);
    expect(result.metadataLines.length).toBeGreaterThan(0);
    expect(result.noiseLines.length).toBeGreaterThan(0);
    
    // Check that noise was removed
    const allContent = result.contentLines.map(c => c.raw).join(" ");
    expect(allContent).not.toContain("LEAVE ME ALONE");
    expect(allContent).not.toContain("Email:");
    expect(allContent).not.toContain("@");
    expect(allContent).not.toContain("©");
    expect(allContent).not.toContain("All rights");
    expect(allContent).not.toContain("Slide 5");
    
    // Check that medical content remains
    expect(allContent).toContain("pericardium");
    expect(allContent).toContain("heart");
  });

  it("reconstructCleanText works", () => {
    const raw = `
      The pericardium is a fibrous sac.
      The heart pumps blood.
    `;
    const result = cleanSourceText(raw);
    const reconstructed = reconstructCleanText(result);
    
    expect(reconstructed).toContain("pericardium");
    expect(reconstructed).toContain("heart");
    expect(reconstructed).not.toContain("LEAVE ME ALONE");
  });

  it("handles Arabic content correctly", () => {
    const raw = `
      إعداد: د. أحمد
      التامور هو كيس ليفي يحيط بالقلب.
      جميع الحقوق محفوظة
    `;
    const result = cleanSourceText(raw);
    
    const allContent = result.contentLines.map(c => c.raw).join(" ");
    expect(allContent).toContain("التامور");
    expect(allContent).toContain("قلب");
    expect(allContent).not.toContain("إعداد");
    expect(allContent).not.toContain("الحقوق محفوظة");
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

  it("deduplicates with similarity threshold", () => {
    const items = [
      { t: "The pericardium is a fibrous sac" },
      { t: "The pericardium is a fibrous sac." },
      { t: "The heart pumps blood." },
    ];
    const result = deduplicateLines(
      items.map(t => ({ raw: t.t, class: "CONTENT" as const, norm: t.t }))
    );
    // First two should be deduped
    expect(result.length).toBe(2);
  });
});