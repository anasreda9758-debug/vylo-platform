import { describe, expect, it } from "vitest";
import {
  isAnaphoric,
  lastTopicFromHistory,
  resolveConversationalFocus,
} from "./tutor-context";
import { createSourceTutorReply } from "./source-generators";
import { cleanedSource } from "./source-cleaner";

const CONTENT = `
The pericardium is a fibrous double-walled sac that surrounds the heart and the roots of the great vessels.
Acute pericarditis is classified into three forms: serous, fibrinous and purulent.
Left ventricular hypertrophy causes reduced cardiac output and heart failure.
Hypertrophy differs from hyperplasia because the cell size changes rather than the number.
Papillary muscle rupture causes acute mitral regurgitation after myocardial infarction.
`;

/* ------------------------------------------------------------------ */
/* referent detection                                                  */
/* ------------------------------------------------------------------ */

describe("isAnaphoric", () => {
  it("detects standalone English pronouns", () => {
    expect(isAnaphoric("What causes it?")).toBe(true);
    expect(isAnaphoric("Explain this")).toBe(true);
    expect(isAnaphoric("Why does that happen?")).toBe(true);
  });

  it("detects standalone Arabic demonstratives", () => {
    expect(isAnaphoric("اشرح ده")).toBe(true);
    expect(isAnaphoric("ما سبب هذه؟")).toBe(true);
    expect(isAnaphoric("وضح هذا")).toBe(true);
  });

  it("detects Arabic suffix pronouns on common stems", () => {
    expect(isAnaphoric("ما أسبابها؟")).toBe(true);
    expect(isAnaphoric("ما وظيفة هذا؟")).toBe(true);
    expect(isAnaphoric("اذكر أنواعه؟")).toBe(true);
  });

  it("detects an object pronoun attached to an Arabic verb", () => {
    // "اوصفه" is a verb plus a pronoun, not a noun stem plus a suffix.
    expect(isAnaphoric("اوصفه باختصار")).toBe(true);
    expect(isAnaphoric("اشرحها")).toBe(true);
    expect(isAnaphoric("وضحهم")).toBe(true);
  });

  it("does not treat an Arabic copula question as a reference", () => {
    // The "ه" of "هو" is followed by another letter, so "ما هو" is not a
    // pronoun reference and must not swallow a self-contained question.
    expect(isAnaphoric("ما هو التامور؟")).toBe(false);
    expect(isAnaphoric("ما هي انواع الالتهاب؟")).toBe(false);
  });

  it("leaves self-contained questions untouched", () => {
    expect(isAnaphoric("What is the pericardium?")).toBe(false);
    expect(isAnaphoric("What causes hypertrophy?")).toBe(false);
    expect(isAnaphoric("ما هو التامور؟")).toBe(false);
    expect(isAnaphoric("What is the renal cortex?")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* topic extraction                                                    */
/* ------------------------------------------------------------------ */

describe("lastTopicFromHistory", () => {
  it("prefers the bold topic label from the assistant reply", () => {
    const history = [
      { role: "user", content: "What is pericarditis?" },
      { role: "assistant", content: "**Pericarditis**\n\nDefinition related to the pericardium." },
    ];
    expect(lastTopicFromHistory(history)).toBe("Pericarditis");
  });

  it("falls back to terms in prior user questions", () => {
    const history = [
      { role: "user", content: "What is pericarditis?" },
    ];
    expect(lastTopicFromHistory(history)).toBe("pericarditis");
  });

  it("returns null for an empty or unrelated history", () => {
    expect(lastTopicFromHistory([])).toBeNull();
    expect(lastTopicFromHistory([{ role: "assistant", content: "No topic here." }])).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* resolution                                                          */
/* ------------------------------------------------------------------ */

describe("resolveConversationalFocus", () => {
  it("resolves an anaphoric question to the last topic", () => {
    const history = [
      { role: "user", content: "What is pericarditis?" },
      { role: "assistant", content: "**Pericarditis**\n\nAn inflammation of the pericardium." },
    ];
    expect(resolveConversationalFocus("What causes it?", history)).toEqual({
      focus: "Pericarditis",
      wantsClarification: false,
    });
  });

  it("never modifies self-contained questions", () => {
    const history = [{ role: "user", content: "What is pericarditis?" }];
    expect(resolveConversationalFocus("What is hypertrophy?", history)).toEqual({
      focus: null,
      wantsClarification: false,
    });
  });

  it("asks for clarification when history has no topic", () => {
    expect(resolveConversationalFocus("What causes it?", [])).toEqual({
      focus: null,
      wantsClarification: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/* end-to-end follow-up behaviour                                      */
/* ------------------------------------------------------------------ */

describe("tutor follow-up context", () => {
  it("English: 'What causes it?' resolves to the last discussed topic", () => {
    const first = createSourceTutorReply("Cardiovascular", CONTENT, null, "What is acute pericarditis?");
    expect(first).toMatch(/pericarditis/i);

    const followUp = createSourceTutorReply("Cardiovascular", CONTENT, null, "What causes it?", {
      history: [{ role: "user", content: "What is acute pericarditis?" }, { role: "assistant", content: first }],
    });
    expect(followUp).toMatch(/pericarditis|pericardium/i);
    expect(followUp).toMatch(/serous|fibrinous|purulent/i);
  });

  it("Arabic: 'اشرح ده' resolves and explains the previous topic", () => {
    const history = [
      { role: "user", content: "ما هو التامور؟" },
      { role: "assistant", content: "**التامور**\n\nغشاء ليفي يحيط بالقلب." },
    ];
    const followUp = createSourceTutorReply("Cardiovascular", CONTENT, null, "اشرح ده", { history });
    expect(followUp).toMatch(/التامور|pericardium/i);
  });

  it("asks a clarifying question when there is no prior topic", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "What causes it?", { history: [] });
    expect(reply).toMatch(/couldn’t tell|which topic/i);
  });

  it("Arabic clarification when no prior topic", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "اشرح ده", { history: [] });
    expect(reply).toMatch(/المصطلح المقصود|المفهوم/i);
  });

  it("self-contained questions ignore follow-up resolution", () => {
    const reply = createSourceTutorReply("Cardiovascular", CONTENT, null, "How does hypertrophy differ from hyperplasia?", {
      history: [{ role: "user", content: "What is pericarditis?" }],
    });
    expect(reply).toMatch(/hypertrophy/i);
    expect(reply).toMatch(/hyperplasia/i);
  });

  it("cleaned source still powers the follow-up path", () => {
    const noisy = `Prepared by: Dr. Ahmed\nEmail: dr@x.edu\n${CONTENT}\n© 2025 All rights reserved`;
    expect(cleanedSource(noisy)).toMatch(/pericardium/i);
    const reply = createSourceTutorReply("Cardiovascular", noisy, null, "What is hypertrophy?", { history: [] });
    expect(reply).toMatch(/hypertrophy/i);
    expect(reply).not.toMatch(/@|Prepared by|©/i);
  });
});