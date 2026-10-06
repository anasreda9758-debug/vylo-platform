import type { PracticalImage, PracticalQuestion } from "./model";

// Original, non-medical geometry for UX/security testing. Never university content.
export const FIXTURE_STORAGE_KEY = "__development_marker_board__";
export const fixtureSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">
<rect width="960" height="540" fill="#f8fafc"/><text x="480" y="55" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-size="24">DEVELOPMENT FIXTURE — NOT ANATOMY</text>
<circle cx="240" cy="260" r="88" fill="#dbeafe" stroke="#1e40af" stroke-width="5"/>
<rect x="410" y="172" width="176" height="176" rx="12" fill="#fef3c7" stroke="#92400e" stroke-width="5"/>
<path d="M745 172 L845 348 L645 348 Z" fill="#d1fae5" stroke="#065f46" stroke-width="5"/>
<text x="480" y="470" text-anchor="middle" fill="#334155" font-family="sans-serif" font-size="22">Neutral shapes for testing markers, feedback and saved mistakes.</text></svg>`;

export function makeDevelopmentFixtures({ trackId, moduleId, studyYear, subject }: {
  trackId: string;
  moduleId: string;
  studyYear: number;
  subject: string;
}) {
  const fixtureKey = trackId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  const imageId = `dev-${fixtureKey}-markers-v1`;
  const sourceMaterial = { title: "Development marker board — not a medical source", path: "src/features/practical/fixtures.ts", sha256: "", approvedBy: null, approvedAt: null };
  const image: PracticalImage = {
    id: imageId, trackId, moduleId, subject, studyYear, storageKey: FIXTURE_STORAGE_KEY,
    alt: "Development fixture: three neutral shapes, not an anatomical specimen", sourceMaterial, sourcePage: 1,
    markers: [{ id: "1", x: 0.25, y: 0.4815, label: "1" }, { id: "2", x: 0.51875, y: 0.4815, label: "2" }, { id: "3", x: 0.776, y: 0.5259, label: "3" }],
    status: "DRAFT_AI", isFixture: true,
  };
  const targets = ["circle", "square", "triangle"];
  const questions: PracticalQuestion[] = Array.from({ length: 10 }, (_, index) => {
    const target = index % targets.length;
    return {
      id: `dev-${fixtureKey}-marker-${index + 1}`, trackId, academicYearId: null, studyYear, moduleId, subject,
      sourceLectureId: null, sourceMaterial, sourcePage: 1, questionType: "LABELED_STRUCTURE", answerFormat: "SINGLE_CHOICE",
      imageId: image.id, markerIds: [String(target + 1)], groupId: `dev-${fixtureKey}-marker-board-v1`, order: index,
      prompt: `[Development fixture ${index + 1}] Which shape is indicated by label ${target + 1}?`,
      options: [...targets, "hexagon"].map((name) => ({ id: `shape-${name}`, text: name[0].toUpperCase() + name.slice(1) })),
      correctOptionId: `shape-${targets[target]}`, explanation: `Label ${target + 1} is positioned inside the ${targets[target]}. This validates the interface only, not medical knowledge.`,
      identifyingClue: "Follow the numbered marker to the shape containing it.",
      commonMistake: "Selecting a neighboring shape rather than the marked target.",
      examTip: "This is a development exercise. No university question or medical fact is being assessed.",
      status: "DRAFT_AI", isFixture: true,
    };
  });
  return { image, questions };
}
