// Local browser QA. SELECT-only DB inspection; legitimate existing student login.
// Fixed-date screenshots use server-rendered test fixtures, NEVER a runtime clock override.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), true);
const baseURL = "http://localhost:3000";
const output = "tmp/academic-visibility-qa";
mkdirSync(output, { recursive: true });
const report = { runtime: {}, controlledDateScreenshots: [], errors: [], failedRequests: [], limitations: ["Term 2/Summer browser views use fixed-date SSR fixtures of the actual components; they are not live end-to-end sessions.", "Admin configuration warnings are covered by policy/API inspection; no admin login/password change attempted."] };
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
let futureLecture;
let futurePlan;
try {
  [futureLecture] = await sql.unsafe("SELECT l.id, l.slug, m.id AS module_id FROM lecture l JOIN module m ON m.id=l.module_id JOIN academic_period p ON p.id=m.academic_period_id WHERE p.type='TERM_2' ORDER BY l.id LIMIT 1");
  [futurePlan] = await sql.unsafe("SELECT id FROM plan WHERE scope='term' AND scope_ref='2' LIMIT 1");
} finally { await sql.end(); }
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  new MutationObserver(() => document.querySelectorAll("nextjs-portal").forEach((element) => { element.style.display = "none"; }))
    .observe(document, { childList: true, subtree: true });
});
const page = await context.newPage();
let recording = false;
page.on("pageerror", (error) => { if (recording) report.errors.push(error.message.slice(0, 200)); });
page.on("console", (message) => { if (recording && message.type() === "error") report.errors.push(message.text().slice(0, 200)); });
page.on("response", (response) => {
  if (recording && response.url().startsWith(baseURL) && response.status() >= 400)
    report.failedRequests.push({ path: new URL(response.url()).pathname, status: response.status() });
});
try {
  await page.goto(`${baseURL}/sign-in`);
  const source = readFileSync("scripts/seed-test-users.ts", "utf8"); // NEVER execute seed.
  const password = process.env.QA_STUDENT_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? source.match(/const PASSWORD =[^\n]*\?\? "([^"]+)"/)?.[1];
  if (!password) throw new Error("Existing local test password unavailable; no reset attempted.");
  await page.locator('input[type="email"]').fill(process.env.QA_STUDENT_EMAIL ?? "student001@test.horus.edu.eg");
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });
  await context.addCookies([{ name: "horus_locale", value: "en", url: baseURL }]);
  recording = true;
  await page.goto(`${baseURL}/dashboard`);
  report.runtime.dashboardCurrentTerm = !(await page.locator('main a[href*="/curriculum/rs-201"], main a[href*="/curriculum/rau-203"]').count());
  report.runtime.dashboardYears = await page.locator('select[aria-label="Select academic year"] option').allTextContents();
  // Turbopack dev can inject CSS via <style>, not stylesheet links.
  const css = await page.evaluate(() => Array.from(document.styleSheets).map((sheet) => {
    try { return Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n"); } catch { return ""; }
  }).join("\n"));
  if (!css.includes("--background")) throw new Error("Application CSS unavailable for controlled-date visual QA.");
  report.runtime.visual = [];
  for (const path of ["dashboard", "curriculum"]) for (const width of [1440, 375]) for (const mode of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${baseURL}/${path}`);
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), mode === "dark");
    await page.screenshot({ path: `${output}/runtime-${path}-${width}-${mode}.png`, fullPage: true });
    report.runtime.visual.push({ path, width, mode, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
  }
  await page.goto(`${baseURL}/curriculum`);
  report.runtime.moduleTerms = await page.getByRole("navigation", { name: "Filter by term" }).innerText();
  report.runtime.moduleYears = await page.locator('select[aria-label="Select academic year"] option').allTextContents();
  report.runtime.futureModulesAbsent = !(await page.locator('main a[href*="/curriculum/rs-201"], main a[href*="/curriculum/rau-203"]').count());
  report.runtime.summerAbsent = !(await page.locator("main").innerText()).includes("Summer");
  await page.goto(`${baseURL}/curriculum?year=2&term=2`);
  report.runtime.queryCannotRevealFuture = !(await page.locator('main a[href*="/curriculum/rs-201"], main a[href*="/curriculum/rau-203"]').count());
  const weeklyResponse = await context.request.get(`${baseURL}/api/planning/weekly`);
  const weekly = await weeklyResponse.json();
  const weeklyText = JSON.stringify(weekly);
  report.runtime.weeklyPlan = weeklyResponse.status() === 200 && !weeklyText.includes("rs-201") && !weeklyText.includes("rau-203");
  await page.goto(`${baseURL}/pricing`);
  report.runtime.pricingFutureAndSummerAbsent = !/Summer retakes|Term 2\b/.test(await page.locator("main").innerText());
  recording = false; // Expected negative tests below intentionally return 404/403.
  const moduleResponse = await context.request.get(`${baseURL}/curriculum/rau-203`);
  report.runtime.directFutureModule = { status: moduleResponse.status(), denied: !((await moduleResponse.text()).includes("<h1") && (await moduleResponse.text()).includes("Renal &amp; Urinary")) };
  if (futureLecture) {
    const pdf = await context.request.get(`${baseURL}/api/content/pdf/${futureLecture.id}`);
    const notes = await context.request.get(`${baseURL}/api/lecture-notes?lectureId=${encodeURIComponent(futureLecture.id)}`);
    const lecture = await context.request.get(`${baseURL}/lecture/${futureLecture.slug}`);
    report.runtime.directFutureLecture = lecture.status();
    report.runtime.futurePdf = pdf.status();
    report.runtime.futureNotes = notes.status();
  }
  const search = await context.request.get(`${baseURL}/api/search?q=renal&module=rau-203`);
  report.runtime.futureSearch = { status: search.status(), results: (await search.json()).results?.length };
  if (futurePlan) {
    report.runtime.futurePricePreview = (await context.request.post(`${baseURL}/api/billing/price-preview`, { data: { planId: futurePlan.id } })).status();
  }
  if (futureLecture) {
    report.runtime.inactiveSummerPreview = (await context.request.post(`${baseURL}/api/billing/summer-preview`, { data: { moduleIds: [futureLecture.module_id] } })).status();
  }
  const fixturePage = await context.newPage();
  for (const period of ["term1", "term2", "summer"]) {
    const fixture = readFileSync(`${output}/${period}.html`, "utf8");
    for (const width of [1440, 375]) for (const mode of ["light", "dark"]) {
      await fixturePage.setViewportSize({ width, height: 1000 });
      await fixturePage.setContent(`<!doctype html><html class="${mode === "dark" ? "dark" : ""}"><head><style>${css}</style></head><body class="bg-background text-foreground">${fixture}</body></html>`, { waitUntil: "networkidle" });
      const overflow = await fixturePage.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const path = `${output}/${period}-${width}-${mode}.png`;
      await fixturePage.screenshot({ path, fullPage: true });
      report.controlledDateScreenshots.push({ period, width, mode, overflow, path });
    }
  }
  report.runtime.unexpectedErrors = report.errors.length;
  report.runtime.unexpectedFailedRequests = report.failedRequests.length;
  writeFileSync("reports/academic-visibility-qa.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
