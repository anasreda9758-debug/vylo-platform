/** Explicit, local-only fixture setup. Migrations must already be applied. */
import { and, eq } from "drizzle-orm";
import { db, client } from "../src/shared/db";
import { practicalImage, practicalQuestion, practicalTrack } from "../src/features/practical/schema";
import { makeDevelopmentFixtures } from "../src/features/practical/fixtures";
import { PRACTICAL_SUBJECT_CONFIG } from "../src/features/practical/model";

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? "";
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const moduleSlug = argument("module");
  const subjectSlug = argument("subject");
  const subject = PRACTICAL_SUBJECT_CONFIG.find((item) => item.slug === subjectSlug);
  if (!process.argv.includes("--local-fixtures") || !moduleSlug || !subject || process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/lms") {
    throw new Error("Refusing setup: requires --local-fixtures, --module=<slug>, --subject=<supported slug>, and the local lms development database");
  }
  const [before] = await client.unsafe("SELECT (SELECT count(*)::int FROM module) AS modules, (SELECT count(*)::int FROM lecture) AS lectures");
  if (before.modules !== 7 || before.lectures !== 248) throw new Error("STOP: curriculum counts conflict with the recovered 7 modules / 248 lectures. No recovery attempted.");
  const modules = await client.unsafe("SELECT id, name, study_year FROM module WHERE slug = $1", [moduleSlug]);
  if (modules.length !== 1) throw new Error("STOP: expected exactly one requested module");
  const schema = await client.unsafe("SELECT to_regclass('public.practical_track') AS track, to_regclass('public.practical_question') AS question");
  if (!schema[0]?.track || !schema[0]?.question) throw new Error("Practical migrations 0014 and 0015 must be applied before fixture setup");

  const requestedTrackId = `practical-track-${moduleSlug}-${subject.slug}`;
  await db.insert(practicalTrack).values({
    id: requestedTrackId,
    moduleId: modules[0].id,
    subject: subject.subject,
    subjectSlug: subject.slug,
    displayNameEn: subject.displayNameEn,
    displayNameAr: subject.displayNameAr,
    status: "PUBLISHED",
    practiceEnabled: true,
    ospeEnabled: false,
  }).onConflictDoNothing();
  const [track] = await db.select().from(practicalTrack).where(and(eq(practicalTrack.moduleId, modules[0].id), eq(practicalTrack.subjectSlug, subject.slug))).limit(1);
  if (!track) throw new Error("Practical track could not be resolved after setup");

  const existing = await db.select({ id: practicalQuestion.id }).from(practicalQuestion).where(and(eq(practicalQuestion.trackId, track.id), eq(practicalQuestion.isFixture, true))).limit(1);
  let fixtureQuestions = 0;
  if (existing.length === 0) {
    const fixtures = makeDevelopmentFixtures({ trackId: track.id, moduleId: modules[0].id, studyYear: modules[0].study_year, subject: track.displayNameEn });
    await db.transaction(async (tx) => {
      await tx.insert(practicalImage).values(fixtures.image).onConflictDoNothing();
      await tx.insert(practicalQuestion).values(fixtures.questions).onConflictDoNothing();
    });
    fixtureQuestions = fixtures.questions.length;
  }
  const [after] = await client.unsafe("SELECT (SELECT count(*)::int FROM module) AS modules, (SELECT count(*)::int FROM lecture) AS lectures");
  console.log(JSON.stringify({ before, after, track: { moduleSlug, subject: subject.subject, subjectSlug }, fixtureQuestionsAdded: fixtureQuestions, realQuestionsImported: 0 }));
}
main().finally(() => client.end()).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
