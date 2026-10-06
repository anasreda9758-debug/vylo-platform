// Builds no-cost, source-bound practice questions from the verified lecture
// summaries. Questions intentionally test whether a point belongs to a lesson;
// no hosted model and no invented medical fact is involved.

import postgres from "postgres";

const DB = process.env.DATABASE_URL ?? "postgres://postgres:lms_dev@localhost:5432/lms";
const sql = postgres(DB, { max: 3 });

function clean(value) {
  return String(value ?? "")
    .replace(/^[◆■▌•▪◦●▪\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/\.{3,}/g, "…")
    .trim();
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/.test(value);
}

function factsFor(lecture) {
  const fromSummary = Array.isArray(lecture.summary_json?.keyPoints)
    ? lecture.summary_json.keyPoints
    : [];
  const fromMap = Array.isArray(lecture.mindmap_json?.children)
    ? lecture.mindmap_json.children.flatMap((node) =>
        Array.isArray(node.children) && node.children.length
          ? node.children.map((child) => child.label)
          : [node.label],
      )
    : [];
  return [...new Set([...fromSummary, ...fromMap].map(clean))]
    .filter((fact) => fact.length >= 8 && fact.length <= 180 && !containsArabic(fact))
    .slice(0, 3);
}

function stableOptions(correct, pool, offset) {
  const choices = [correct];
  for (let i = 0; i < pool.length && choices.length < 4; i++) {
    const candidate = pool[(i + offset) % pool.length];
    if (candidate !== correct && !choices.includes(candidate)) choices.push(candidate);
  }
  while (choices.length < 4) choices.push(`Not listed in this lecture (${choices.length + 1})`);
  return choices.sort((a, b) => a.localeCompare(b));
}

async function main() {
  const modules = await sql`
    SELECT id, slug, name
    FROM module
    ORDER BY "order"
  `;
  const lectures = await sql`
    SELECT id, module_id, slug, title, summary_json, mindmap_json
    FROM lecture
    WHERE summary_json IS NOT NULL OR mindmap_json IS NOT NULL
    ORDER BY "order"
  `;
  const allFacts = lectures.flatMap(factsFor);
  let bankCount = 0;
  let questionCount = 0;

  for (const moduleRow of modules) {
    const bankId = `source-bank-${moduleRow.slug}`;
    const bankSlug = `source-quiz-${moduleRow.slug}`;
    await sql`
      INSERT INTO question_bank (id, module_id, slug, title)
      VALUES (${bankId}, ${moduleRow.id}, ${bankSlug}, ${`${moduleRow.name} source review`})
      ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
    `;
    bankCount++;

    const moduleLectures = lectures.filter((lecture) => lecture.module_id === moduleRow.id);
    for (const lecture of moduleLectures) {
      const facts = factsFor(lecture);
      for (let index = 0; index < facts.length; index++) {
        const correct = facts[index];
        const questionId = `source-question-${lecture.slug}-${index + 1}`;
        const prompt = `Which statement appears explicitly in the lecture “${lecture.title}”?`;
        await sql`
          INSERT INTO question (id, bank_id, lecture_id, prompt, explanation, difficulty, "order")
          VALUES (
            ${questionId},
            ${bankId},
            ${lecture.id},
            ${prompt},
            ${`The answer is taken directly from the summary of “${lecture.title}”.`},
            ${index === 0 ? "easy" : index === 1 ? "medium" : "hard"},
            ${index + 1}
          )
          ON CONFLICT (id) DO UPDATE SET
            prompt = EXCLUDED.prompt,
            explanation = EXCLUDED.explanation,
            difficulty = EXCLUDED.difficulty,
            "order" = EXCLUDED."order"
        `;

        const options = stableOptions(correct, allFacts, questionCount + index);
        for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
          await sql`
            INSERT INTO question_option (id, question_id, text, is_correct, "order")
            VALUES (
              ${`source-option-${lecture.slug}-${index + 1}-${optionIndex + 1}`},
              ${questionId},
              ${options[optionIndex]},
              ${options[optionIndex] === correct},
              ${optionIndex + 1}
            )
            ON CONFLICT (id) DO UPDATE SET
              text = EXCLUDED.text,
              is_correct = EXCLUDED.is_correct,
              "order" = EXCLUDED."order"
          `;
        }
        questionCount++;
      }
    }
  }

  console.log(JSON.stringify({ banks: bankCount, questions: questionCount }, null, 2));
  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exitCode = 1;
});
