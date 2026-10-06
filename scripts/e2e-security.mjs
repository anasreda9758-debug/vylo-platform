/**
 * Security-focused end-to-end checks.
 *
 * This script MUST only run against a disposable database whose name starts
 * with `horus_e2e_`. `run-e2e-security.mjs` creates and removes that database.
 * It deliberately exercises the application through HTTP (and a real browser)
 * rather than calling application internals.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const TEST_DATABASE_URL = process.env.E2E_DATABASE_URL;
const PASSWORD = "E2eSecurity!2026";
const COOKIE_NAME = "lms.session_token";

if (!TEST_DATABASE_URL) throw new Error("E2E_DATABASE_URL is required");
const testDatabaseName = decodeURIComponent(new URL(TEST_DATABASE_URL).pathname.slice(1));
if (!/^horus_e2e_[a-z0-9_]+$/i.test(testDatabaseName)) {
  throw new Error(`Refusing to run security tests against non-disposable database: ${testDatabaseName}`);
}

const sql = postgres(TEST_DATABASE_URL, { max: 1 });
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` (${detail})` : ""}`);
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function cookieOf(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookie = cookies.find((value) => value.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) throw new Error("Authentication response did not set a session cookie");
  return cookie.split(";", 1)[0];
}

async function call(path, { method = "GET", cookie, body, redirect = "manual" } = {}) {
  const headers = { Origin: BASE };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  let json = null;
  if (contentType.includes("application/json")) {
    try { json = JSON.parse(text); } catch { /* asserted as a failed status below */ }
  }
  return { response, status: response.status, text, json, contentType };
}

async function signUp(label) {
  const email = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@security-e2e.local`;
  const result = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: `Security E2E ${label}`, email, password: PASSWORD },
  });
  assert.equal(result.status, 200, `sign-up failed for ${label}: ${result.status} ${result.text}`);
  const cookie = cookieOf(result.response);
  const session = await call("/api/auth/get-session", { cookie });
  assert.equal(session.status, 200, `session lookup failed for ${label}`);
  assert.ok(session.json?.user?.id, `missing user id for ${label}`);
  return { label, email, cookie, id: session.json.user.id };
}

function hasLeak(result, secrets) {
  const body = result.text.toLowerCase();
  return secrets.some((secret) => secret && body.includes(String(secret).toLowerCase()));
}

function expectStatus(name, result, expected, secrets = []) {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  check(name, expectedStatuses.includes(result.status) && !hasLeak(result, secrets), `status=${result.status}`);
}

function browserCookie(cookie) {
  const [name, value] = cookie.split("=", 2);
  return { name, value, url: BASE, httpOnly: true, sameSite: "Lax" };
}

async function fixture() {
  const modules = await sql`
    select m.id, m.slug, m.is_free
    from module m
    where m.slug = 'cvs-202'
  `;
  assert.equal(modules.length, 1, "Expected the recovered paid CVS-202 module in the isolated test copy");
  assert.equal(modules[0].is_free, false, "CVS-202 must remain a paid-module access fixture");

  const lectures = await sql`
    select l.id, l.slug, l.title, l.content, l.pdf_file
    from lecture l
    where l.module_id = ${modules[0].id}
    order by l."order" asc
    limit 2
  `;
  assert.equal(lectures.length, 2, "Expected two CVS lectures for preview and protected checks");
  assert.ok(lectures[0].pdf_file, "Expected the real first CVS lecture to have a PDF source");
  assert.ok(lectures[1].pdf_file, "Expected the real protected CVS lecture to have a PDF source");
  assert.ok(lectures[1].content?.trim(), "Expected real source text for the protected CVS lecture");

  const banks = await sql`
    select id, slug, title from question_bank where module_id = ${modules[0].id} limit 1
  `;
  assert.equal(banks.length, 1, "Expected an existing CVS question bank");
  const questionRows = await sql`
    select q.id, q.prompt, q.explanation, o.id as option_id
    from question q
    join question_option o on o.question_id = q.id
    where q.bank_id = ${banks[0].id}
    order by q."order" asc, o."order" asc
    limit 1
  `;
  assert.equal(questionRows.length, 1, "Expected an existing CVS question and option");
  const otherQuestionRows = await sql`
    select q.id, o.id as option_id
    from question q
    join question_option o on o.question_id = q.id
    join question_bank b on b.id = q.bank_id
    where b.module_id <> ${modules[0].id}
    order by q."order" asc, o."order" asc
    limit 1
  `;
  assert.equal(otherQuestionRows.length, 1, "Expected a question in a different bank for boundary testing");
  const ospe = await sql`select folder, file_name from ospe_answer_key where folder = 'CVS' limit 1`;
  assert.equal(ospe.length, 1, "Expected recovered CVS OSPE answer-key data");
  return {
    module: modules[0],
    preview: lectures[0],
    protectedLecture: lectures[1],
    bank: banks[0],
    question: questionRows[0],
    otherQuestion: otherQuestionRows[0],
    ospe: { folder: ospe[0].folder, fileName: ospe[0].file_name },
  };
}

async function grantModuleAccess(userId) {
  await sql`
    insert into subscription (id, user_id, plan_id, status, starts_at, expires_at)
    values (${randomUUID()}, ${userId}, 'module-cvs-202', 'active', now() - interval '1 minute', now() + interval '1 day')
  `;
}

async function runBrowserChecks({ noEntitlement, entitled, fixture: data }) {
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const executablePath = process.env.E2E_BROWSER_EXECUTABLE
    ?? (existsSync(chromium.executablePath()) ? chromium.executablePath() : (existsSync(edge) ? edge : undefined));
  if (!executablePath) {
    check("browser executable available", false, "Playwright Chromium and local Edge are unavailable");
    return;
  }
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const anonymous = await browser.newContext();
    const anonPage = await anonymous.newPage();
    await anonPage.goto(`${BASE}/lecture/${data.protectedLecture.slug}`, { waitUntil: "domcontentloaded" });
    check("browser anonymous lecture redirects to sign-in", anonPage.url().includes("/sign-in"), anonPage.url());
    await anonymous.close();

    const locked = await browser.newContext();
    await locked.addCookies([browserCookie(noEntitlement.cookie)]);
    const lockedPage = await locked.newPage();
    await lockedPage.goto(`${BASE}/lecture/${data.protectedLecture.slug}`, { waitUntil: "domcontentloaded" });
    const lockedText = await lockedPage.locator("body").innerText();
    check("browser blocked lecture hides source text", lockedText.includes("This lecture is locked") && !lockedText.includes(data.protectedLecture.content.slice(0, 80)));
    await lockedPage.goto(`${BASE}/lecture/${data.preview.slug}`, { waitUntil: "domcontentloaded" });
    const previewText = await lockedPage.locator("body").innerText();
    check("browser first lecture is explicit free preview", previewText.includes("Free preview"));
    await locked.close();

    const full = await browser.newContext();
    await full.addCookies([browserCookie(entitled.cookie)]);
    const fullPage = await full.newPage();
    await fullPage.goto(`${BASE}/lecture/${data.protectedLecture.slug}`, { waitUntil: "domcontentloaded" });
    const fullText = await fullPage.locator("body").innerText();
    check(
      "browser entitled lecture renders its source-content section",
      fullText.includes("Lecture text") && !fullText.includes("This lecture is locked") && fullText.includes(data.protectedLecture.title),
    );
    await full.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const data = await fixture();
  const noEntitlement = await signUp("no-entitlement");
  const entitled = await signUp("module-entitled");
  const admin = await signUp("admin");
  const previewOnly = await signUp("preview-only");
  const secondUser = await signUp("second-entitled");
  await grantModuleAccess(entitled.id);
  await grantModuleAccess(secondUser.id);
  await sql`update "user" set role = 'admin' where id = ${admin.id}`;

  const signIn = await call("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: noEntitlement.email, password: PASSWORD },
  });
  check("valid credentials create a server session", signIn.status === 200 && Boolean(cookieOf(signIn.response)), `status=${signIn.status}`);
  const wrongPassword = await call("/api/auth/sign-in/email", {
    method: "POST",
    body: { email: noEntitlement.email, password: "wrong-password" },
  });
  expectStatus("invalid credentials are rejected", wrongPassword, 401);

  const secrets = [
    data.protectedLecture.title,
    data.protectedLecture.content.slice(0, 120),
    data.question.prompt,
    data.question.explanation,
    "isCorrect",
    "modelAnswers",
    "diagnosis",
  ];

  // Authentication must be required everywhere, including direct API calls.
  expectStatus("anonymous PDF API denied", await call(`/api/content/pdf/${data.protectedLecture.id}`), 401, secrets);
  expectStatus("anonymous quiz API denied", await call(`/api/quiz/questions?slug=${encodeURIComponent(data.bank.slug)}`), 401, secrets);
  expectStatus("anonymous notes API denied", await call(`/api/lecture-notes?lectureId=${data.protectedLecture.id}`), 401, secrets);
  expectStatus("anonymous review API denied", await call("/api/review/answer", { method: "POST", body: { questionId: data.question.id, optionId: data.question.option_id } }), 401, secrets);
  expectStatus("anonymous OSPE API denied", await call("/api/ospe/exam", { method: "POST", body: { folder: "CVS", stationCount: 1 } }), 401, secrets);
  expectStatus("anonymous battle API denied", await call("/api/battles/banks"), 401, secrets);
  expectStatus("anonymous search API denied", await call("/api/search?q=cardiovascular"), 401, secrets);

  // Neither a signed-in user without an entitlement nor a preview-only user may escape the preview boundary.
  for (const actor of [noEntitlement, previewOnly]) {
    expectStatus(`${actor.label} protected PDF denied`, await call(`/api/content/pdf/${data.protectedLecture.id}`, { cookie: actor.cookie }), 404, secrets);
    expectStatus(`${actor.label} full quiz denied`, await call(`/api/quiz/questions?slug=${encodeURIComponent(data.bank.slug)}`, { cookie: actor.cookie }), 404, secrets);
    expectStatus(`${actor.label} protected notes denied`, await call("/api/lecture-notes", { method: "POST", cookie: actor.cookie, body: { lectureId: data.protectedLecture.id, body: "must not be saved" } }), 403, secrets);
    expectStatus(`${actor.label} flashcard generation denied`, await call("/api/review/flashcards", { method: "POST", cookie: actor.cookie, body: { lectureId: data.protectedLecture.id } }), 404, secrets);
    expectStatus(`${actor.label} clinical case generation denied`, await call("/api/review/cases", { method: "POST", cookie: actor.cookie, body: { lectureId: data.protectedLecture.id } }), 404, secrets);
    expectStatus(`${actor.label} OSPE folder denied`, await call("/api/ospe/exam", { method: "POST", cookie: actor.cookie, body: { folder: "CVS", stationCount: 1 } }), 403, secrets);
    expectStatus(`${actor.label} battle creation denied`, await call("/api/battles", { method: "POST", cookie: actor.cookie, body: { action: "create", bankSlug: data.bank.slug, questionCount: 1 } }), 404, secrets);
  }
  const previewPdf = await call(`/api/content/pdf/${data.preview.id}`, { cookie: previewOnly.cookie });
  check("preview-only user can retrieve only real first-lecture PDF", previewPdf.status === 200 && previewPdf.contentType.includes("pdf"), `status=${previewPdf.status}`);
  const previewNotes = await call("/api/lecture-notes", { method: "POST", cookie: previewOnly.cookie, body: { lectureId: data.preview.id, body: "preview-private-note" } });
  expectStatus("preview-only user can keep a private preview note", previewNotes, 201);

  // Full module entitlement and administrator role permit the actual module, but quiz data must not disclose answers before submit.
  const fullPdf = await call(`/api/content/pdf/${data.protectedLecture.id}`, { cookie: entitled.cookie });
  check("entitled user can retrieve verified module PDF", fullPdf.status === 200 && fullPdf.contentType.includes("pdf"), `status=${fullPdf.status}`);
  const adminPdf = await call(`/api/content/pdf/${data.protectedLecture.id}`, { cookie: admin.cookie });
  check("administrator can retrieve protected module PDF", adminPdf.status === 200 && adminPdf.contentType.includes("pdf"), `status=${adminPdf.status}`);

  const quiz = await call(`/api/quiz/questions?slug=${encodeURIComponent(data.bank.slug)}&count=1`, { cookie: entitled.cookie });
  check("entitled user receives quiz questions without answers", quiz.status === 200 && Array.isArray(quiz.json?.questions) && quiz.json.questions.length === 1 && !hasLeak(quiz, ["isCorrect", "explanation"]), `status=${quiz.status}`);
  const attemptId = quiz.json?.attemptId;
  const activeQuestion = quiz.json?.questions?.[0];
  assert.ok(attemptId && activeQuestion?.id && activeQuestion.options?.[0]?.id, "Quiz start did not return an active attempt and question");

  const wrongBankQuestion = await call("/api/quiz/answer", {
    method: "POST", cookie: entitled.cookie,
    body: { bankSlug: data.bank.slug, questionId: data.otherQuestion.id, optionId: data.otherQuestion.option_id, attemptId, timeSpentMs: 1 },
  });
  expectStatus("question ID from another bank is rejected", wrongBankQuestion, 404, secrets);
  const answer = await call("/api/quiz/answer", {
    method: "POST", cookie: entitled.cookie,
    body: { bankSlug: data.bank.slug, questionId: activeQuestion.id, optionId: activeQuestion.options[0].id, attemptId, timeSpentMs: 1 },
  });
  check("entitled user receives feedback only after own answer", answer.status === 200 && typeof answer.json?.correct === "boolean", `status=${answer.status}`);
  const finish = await call("/api/quiz/finish", { method: "POST", cookie: entitled.cookie, body: { attemptId } });
  expectStatus("entitled user finishes own quiz attempt", finish, 200);
  const review = await call("/api/review/answer", { method: "POST", cookie: entitled.cookie, body: { questionId: activeQuestion.id, optionId: activeQuestion.options[0].id, timeSpentMs: 1 } });
  check("entitled user can review own scheduled question", review.status === 200 && typeof review.json?.correct === "boolean", `status=${review.status}`);

  // Private records are always scoped to their owner, including administrators.
  expectStatus("second user cannot finish another user's quiz attempt", await call("/api/quiz/finish", { method: "POST", cookie: secondUser.cookie, body: { attemptId } }), 404, secrets);
  expectStatus("administrator cannot finish a student's private quiz attempt", await call("/api/quiz/finish", { method: "POST", cookie: admin.cookie, body: { attemptId } }), 404, secrets);
  expectStatus("second user cannot answer another user's review record", await call("/api/review/answer", { method: "POST", cookie: secondUser.cookie, body: { questionId: activeQuestion.id, optionId: activeQuestion.options[0].id } }), 404, secrets);

  const bookmark = await call("/api/quiz/bookmark", { method: "POST", cookie: entitled.cookie, body: { questionId: activeQuestion.id } });
  expectStatus("entitled user bookmarks own accessible question", bookmark, 200);
  const secondBookmark = await call("/api/quiz/bookmark", { method: "POST", cookie: secondUser.cookie, body: { questionId: activeQuestion.id } });
  expectStatus("second user cannot toggle the first user's bookmark", secondBookmark, 200);
  const ownerBookmark = await call(`/api/quiz/bookmark?questionId=${activeQuestion.id}`, { cookie: entitled.cookie });
  check("bookmark remains isolated to its owner", ownerBookmark.status === 200 && ownerBookmark.json?.bookmarked === true, `status=${ownerBookmark.status}`);

  const note = await call("/api/lecture-notes", { method: "POST", cookie: entitled.cookie, body: { lectureId: data.protectedLecture.id, body: "owner-only security note" } });
  check("entitled user creates private lecture note", note.status === 201 && note.json?.note?.id, `status=${note.status}`);
  const noteId = note.json?.note?.id;
  const secondDelete = await call(`/api/lecture-notes?id=${noteId}`, { method: "DELETE", cookie: secondUser.cookie });
  expectStatus("second user cannot delete another user's note", secondDelete, 200);
  const ownerNotes = await call(`/api/lecture-notes?lectureId=${data.protectedLecture.id}`, { cookie: entitled.cookie });
  check("owner's note persists after cross-user delete attempt", ownerNotes.status === 200 && ownerNotes.json?.notes?.some((entry) => entry.id === noteId), `status=${ownerNotes.status}`);

  const cards = await call("/api/review/flashcards", { method: "POST", cookie: entitled.cookie, body: { lectureId: data.protectedLecture.id } });
  check("entitled user creates source-grounded flashcards", cards.status === 200 && Number(cards.json?.count) > 0, `status=${cards.status}`);
  const ownerCards = await sql`select id from flashcard where user_id = ${entitled.id} order by created_at desc limit 1`;
  assert.ok(ownerCards[0]?.id, "Expected flashcard fixture to be created");
  expectStatus("second user cannot review another user's flashcard", await call("/api/review/flashcards/review", { method: "POST", cookie: secondUser.cookie, body: { cardId: ownerCards[0].id, rating: "good" } }), 404, secrets);

  const clinicalCase = await call("/api/review/cases", { method: "POST", cookie: entitled.cookie, body: { lectureId: data.protectedLecture.id } });
  check("entitled user creates source-grounded clinical case", clinicalCase.status === 200 && clinicalCase.json?.caseId && Array.isArray(clinicalCase.json?.questions), `status=${clinicalCase.status}`);
  const caseId = clinicalCase.json?.caseId;
  expectStatus("second user cannot evaluate another user's clinical case", await call("/api/review/cases/evaluate", { method: "POST", cookie: secondUser.cookie, body: { caseId, answers: ["cross-user attempt"] } }), 404, secrets);

  const ospeExam = await call("/api/ospe/exam", { method: "POST", cookie: entitled.cookie, body: { folder: "CVS", stationCount: 1, timePerStationSec: 15 } });
  check("entitled user starts an OSPE exam from allowed folder", ospeExam.status === 200 && ospeExam.json?.examId && ospeExam.json?.stations?.length === 1, `status=${ospeExam.status}`);
  const examId = ospeExam.json?.examId;
  const stationId = ospeExam.json?.stations?.[0]?.id;
  expectStatus("second user cannot read another user's OSPE exam", await call(`/api/ospe/exam/${examId}`, { cookie: secondUser.cookie }), 404, secrets);
  expectStatus("second user cannot answer another user's OSPE station", await call(`/api/ospe/exam/${examId}`, { method: "POST", cookie: secondUser.cookie, body: { action: "answer", stationId, answer: "cross-user answer" } }), 404, secrets);

  const battle = await call("/api/battles", { method: "POST", cookie: entitled.cookie, body: { action: "create", bankSlug: data.bank.slug, questionCount: 1 } });
  check("entitled user creates battle for accessible bank", battle.status === 200 && battle.json?.battleId, `status=${battle.status}`);
  const battleId = battle.json?.battleId;
  expectStatus("second entitled user joins accessible battle", await call("/api/battles", { method: "POST", cookie: secondUser.cookie, body: { action: "join", battleId } }), 200);
  expectStatus("unentitled user cannot inspect a protected battle", await call(`/api/battles?id=${battleId}`, { cookie: noEntitlement.cookie }), 404, secrets);
  expectStatus("entitled battle participant can read own battle", await call(`/api/battles?id=${battleId}`, { cookie: secondUser.cookie }), 200);
  expectStatus("battle owner marks ready", await call("/api/battles/ready", { method: "POST", cookie: entitled.cookie, body: { battleId } }), 200);
  expectStatus("second participant marks ready", await call("/api/battles/ready", { method: "POST", cookie: secondUser.cookie, body: { battleId } }), 200);
  expectStatus("unentitled user cannot submit battle answer", await call("/api/battles/answer", { method: "POST", cookie: noEntitlement.cookie, body: { battleId, questionId: activeQuestion.id, optionId: activeQuestion.options[0].id } }), 404, secrets);
  const battleAnswer = await call("/api/battles/answer", { method: "POST", cookie: secondUser.cookie, body: { battleId, questionId: activeQuestion.id, optionId: activeQuestion.options[0].id } });
  check("battle participant can answer only its accessible bank question", battleAnswer.status === 200 && typeof battleAnswer.json?.correct === "boolean", `status=${battleAnswer.status}`);

  const search = await call(`/api/search?q=${encodeURIComponent(data.protectedLecture.title)}&module=cvs-202`, { cookie: noEntitlement.cookie });
  check("search does not expose paid lecture text to unentitled user", search.status === 200 && Array.isArray(search.json?.results) && search.json.results.every((result) => result.lectureId !== data.protectedLecture.id), `status=${search.status}`);

  // Admin API isolation: JSON 401/403 semantics, never a page redirect.
  {
    const adminAnon = await call("/api/admin/practical-review");
    check("anonymous admin API denied with JSON 401 (no redirect)", adminAnon.status === 401 && adminAnon.contentType.includes("json"), `status=${adminAnon.status}, type=${adminAnon.contentType}`);
    const adminAsStudent = await call("/api/admin/practical-review", { cookie: secondUser.cookie });
    check("student admin API denied with JSON 403", adminAsStudent.status === 403 && adminAsStudent.contentType.includes("json"), `status=${adminAsStudent.status}`);
    const adminOk = await call("/api/admin/practical-review", { cookie: admin.cookie });
    check("administrator can reach the practical-review API", adminOk.status === 200 && adminOk.contentType.includes("json"), `status=${adminOk.status}`);
  }

  // Leaderboard user scoping (IDOR regression).
  {
    const own = await call(`/api/leaderboard?userId=${entitled.id}`, { cookie: entitled.cookie });
    check("leaderboard returns own profile by userId", own.status === 200 && "profile" in (own.json ?? {}), `status=${own.status}`);
    const other = await call(`/api/leaderboard?userId=${entitled.id}`, { cookie: secondUser.cookie });
    check("leaderboard refuses another user's profile (IDOR)", other.status === 403, `status=${other.status}`);
    expectStatus("anonymous leaderboard denied", await call("/api/leaderboard"), 401);
  }

  // OSPE station image serving: only (folder,fileName) pairs on the reviewed answer key.
  {
    const reviewed = data.ospe;
    const served = await call(`/api/content/ospe/image?folder=${encodeURIComponent(reviewed.folder)}&file=${encodeURIComponent(reviewed.fileName)}`, { cookie: entitled.cookie });
    check("reviewed OSPE station image serves with nosniff", served.status === 200 && served.response.headers.get("x-content-type-options") === "nosniff", `status=${served.status}`);
    const unreviewed = await call(`/api/content/ospe/image?folder=${encodeURIComponent(reviewed.folder)}&file=never-reviewed.png`, { cookie: entitled.cookie });
    check("unreviewed OSPE file name is never served", unreviewed.status === 404, `status=${unreviewed.status}`);
    const anonImg = await call(`/api/content/ospe/image?folder=${encodeURIComponent(reviewed.folder)}&file=${encodeURIComponent(reviewed.fileName)}`);
    expectStatus("anonymous OSPE image denied", anonImg, 401);
  }

  // Search input clamping stays sane for extreme parameters.
  {
    const missingQ = await call("/api/search", { cookie: entitled.cookie });
    expectStatus("search rejects a missing query", missingQ, 400);
    const long = await call(`/api/search?q=${"x".repeat(600)}`, { cookie: entitled.cookie });
    expectStatus("search rejects an overlong query", long, 400);
    const extreme = await call(`/api/search?q=${encodeURIComponent(data.protectedLecture.title)}&k=999999`, { cookie: entitled.cookie });
    check("search clamps extreme k without a 500", extreme.status === 200, `status=${extreme.status}`);
  }

  await runBrowserChecks({ noEntitlement, entitled, fixture: data });
}

try {
  await main();
} catch (error) {
  failed += 1;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  failures.push(detail);
  console.error(`FATAL ${detail}`);
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

console.log(`\nE2E SECURITY RESULT: ${passed} passed, ${failed} failed`);
if (failures.length) console.log(`Failures:\n- ${failures.join("\n- ")}`);
process.exit(failed === 0 ? 0 : 1);
