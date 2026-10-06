// Local, authenticated UI checks only. Never seeds, migrates, or changes content.
// Uses supplied QA credentials, or the existing local development test account.
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const baseURL = "http://localhost:3000";
const output = "tmp/student-experience-qa";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
// Hide only Next's development overlay, which does not ship in production.
await context.addInitScript(() => {
  const observer = new MutationObserver(() =>
    document.querySelectorAll("nextjs-portal").forEach((element) => {
      element.style.display = "none";
    }),
  );
  observer.observe(document, { childList: true, subtree: true });
});
const page = await context.newPage();
const report = {
  browser: "Installed Microsoft Edge via Playwright",
  login: "NOT VERIFIED",
  checks: [],
  interactions: {},
  errors: [],
  failedRequests: [],
};
let recording = false;
page.on("pageerror", (error) => {
  if (recording) report.errors.push(error.message.slice(0, 200));
});
page.on("console", (message) => {
  if (recording && message.type() === "error")
    report.errors.push(message.text().slice(0, 200));
});
page.on("response", (response) => {
  if (
    recording &&
    response.url().startsWith(baseURL) &&
    response.status() >= 400
  )
    report.failedRequests.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
    });
});
page.on("requestfailed", (request) => {
  if (
    recording &&
    request.url().startsWith(baseURL) &&
    request.failure()?.errorText !== "net::ERR_ABORTED"
  )
    report.failedRequests.push({
      path: new URL(request.url()).pathname,
      error: request.failure()?.errorText,
    });
});
try {
  await page.goto(`${baseURL}/sign-in`);
  const seedSource = readFileSync("scripts/seed-test-users.ts", "utf8");
  const password =
    process.env.QA_STUDENT_PASSWORD ??
    process.env.TEST_USER_PASSWORD ??
    seedSource.match(/const PASSWORD =[^\n]*\?\? "([^"]+)"/)?.[1];
  if (!password)
    throw new Error(
      "Local test credentials unavailable; no password reset attempted.",
    );
  await page
    .locator('input[type="email"]')
    .fill(process.env.QA_STUDENT_EMAIL ?? "student001@test.horus.edu.eg");
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  report.login = "PASS";
  recording = true;
  await context.addCookies([
    { name: "horus_locale", value: "en", url: baseURL },
  ]);
  await page.goto(`${baseURL}/curriculum`);
  const moduleLink = page.locator('main a[href^="/curriculum/"]').first();
  const modulePath = await moduleLink.getAttribute("href");
  await page.goto(`${baseURL}${modulePath}`);
  const lecturePath = await page
    .locator('main a[href^="/lecture/"]')
    .first()
    .getAttribute("href");
  const paths = ["/dashboard", "/curriculum", modulePath, lecturePath];
  for (const theme of ["light", "dark"]) {
    await context.addCookies([
      { name: "horus_theme", value: theme, url: baseURL },
    ]);
    for (const width of (process.argv.includes("--quick") ? [375] : [1440, 1024, 768, 375])) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [index, path] of paths.entries()) {
        await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle" });
        await page.locator("main h1").waitFor();
        const dimensions = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          main: document.querySelector("main").getBoundingClientRect().width,
        }));
        const overflow =
          dimensions.document > width + 1 || dimensions.body > width + 1;
        const screenshot = `${output}/${index}-${width}-${theme}.png`;
        await page.screenshot({ path: screenshot, fullPage: true });
        report.checks.push({
          page: ["Dashboard", "Modules", "Module detail", "Lecture"][index],
          path,
          width,
          theme,
          overflow,
          dimensions,
          screenshot,
        });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/dashboard#weekly-plan`, {
    waitUntil: "networkidle",
  });
  report.interactions.weeklyAnchor = await page
    .locator("#weekly-plan")
    .evaluate((el) => el.open);
  await page.locator("#weekly-plan summary").click();
  report.interactions.weeklyCollapse = !(await page
    .locator("#weekly-plan")
    .evaluate((el) => el.open));
  await page.goto(`${baseURL}${lecturePath}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  report.interactions.summary = await page
    .getByRole("tabpanel", { name: "Summary", exact: true })
    .isVisible();
  await page.getByRole("tab", { name: "Ask VYLO", exact: true }).click();
  report.interactions.tutor = await page
    .getByRole("tabpanel", { name: "Ask VYLO", exact: true })
    .isVisible();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  report.interactions.notes = await page
    .getByRole("tabpanel", { name: "Notes", exact: true })
    .isVisible();
  const noteInput = page
    .getByRole("tabpanel", { name: "Notes", exact: true })
    .locator("textarea");
  await noteInput.fill("Local QA draft — never saved");
  // Notes UI only: no save/delete and no AI request, avoiding data/quota changes.
  await page
    .getByRole("tab", { name: "Notes", exact: true })
    .press("ArrowRight");
  report.interactions.keyboardToolSwitch =
    (await page
      .getByRole("tab", { name: "Practice", exact: true })
      .getAttribute("aria-selected")) === "true";
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  report.interactions.noteDraftPreserved =
    (await noteInput.inputValue()) === "Local QA draft — never saved";
  const canvas = page.locator("canvas").first();
  report.interactions.pdfRendered = await canvas
    .evaluate((el) => el.width > 0 && el.height > 0)
    .catch(() => false);
  if (report.interactions.pdfRendered) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    report.interactions.zoom = true;
    await page
      .getByRole("button", { name: "Toggle thumbnails", exact: true })
      .click();
    report.interactions.thumbnails = await page
      .getByRole("complementary", { name: "Page thumbnails" })
      .isVisible();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const search = page.getByRole("textbox", {
      name: "Search in this document",
    });
    report.interactions.search = await search.isVisible();
    if (await search.isEnabled()) {
      await search.fill("skin");
      report.interactions.searchCount = await page
        .locator('[aria-live="polite"]')
        .first()
        .innerText();
    } else
      report.interactions.searchAvailability =
        "Unavailable for this document (reader's existing text-detection rule)";
    await page
      .getByRole("button", { name: "Close search", exact: true })
      .click();
    const pageInput = page.getByRole("spinbutton", { name: "Page number" });
    const startPage = Number(await pageInput.inputValue());
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    report.interactions.pageNavigation =
      Number(await pageInput.inputValue()) === startPage + 1;
    await page.getByRole("button", { name: "Focus mode", exact: true }).click();
    report.interactions.focus = await page
      .getByRole("button", { name: "Exit focus mode", exact: true })
      .isVisible();
    await page
      .getByRole("button", { name: "Exit focus mode", exact: true })
      .click();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  report.interactions.mobileDrawer = await page.getByRole("dialog").isVisible();
  await page.keyboard.press("Tab");
  report.interactions.mobileFocusContained = await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement));
  await page.keyboard.press("Escape");
  report.interactions.mobileEscape = !(await page
    .getByRole("dialog")
    .isVisible());
  // Read-only empty-state navigation; never enable or publish future content.
  await page.goto(`${baseURL}/curriculum?year=5`, { waitUntil: "networkidle" });
  const emptyPath = await page
    .locator('main a[href^="/curriculum/"]')
    .first()
    .getAttribute("href");
  await page.goto(`${baseURL}${emptyPath}`, { waitUntil: "networkidle" });
  report.interactions.emptyModule = await page
    .getByRole("heading", { name: "No lectures published yet" })
    .isVisible();
  report.interactions.emptyModuleHasNoPaywall =
    (await page.locator('main a[href="/pricing"]').count()) === 0;
  // A second EXISTING development student checks locked presentation. No users
  // or subscriptions are created, changed, or reset.
  const lockedContext = await browser.newContext();
  const loginResponse = await lockedContext.request.post(`${baseURL}/api/auth/sign-in/email`, {
    headers: { origin: baseURL },
    data: { email: "student002@test.horus.edu.eg", password },
  });
  if (loginResponse.ok()) {
    const lockedPage = await lockedContext.newPage();
    await lockedPage.goto(`${baseURL}${modulePath}`, { waitUntil: "networkidle" });
    report.interactions.lockedModule = await lockedPage.getByRole("heading", { name: "Full module access required" }).isVisible();
    report.interactions.lockedToolsHidden = await lockedPage.locator('main a[href^="/quiz/"]').count() === 0;
    if (report.interactions.lockedModule) await lockedPage.screenshot({ path: `${output}/locked-module.png`, fullPage: true });
    await lockedPage.goto(`${baseURL}${lecturePath}`, { waitUntil: "networkidle" });
    report.interactions.lockedLecture = await lockedPage.getByRole("heading", { name: "This lecture is locked" }).isVisible();
    report.interactions.lockedPdfHidden = await lockedPage.locator("canvas").count() === 0;
  } else report.interactions.lockedAccount = "NOT VERIFIED: existing second student login unavailable";
  await lockedContext.close();
  await page.goto(`${baseURL}/curriculum/ppg-102`, { waitUntil: "networkidle" });
  const searchableLecture = await page.locator('main a[href^="/lecture/"]').first().getAttribute("href");
  await page.goto(`${baseURL}${searchableLecture}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const searchableInput = page.getByRole("textbox", { name: "Search in this document" });
  try {
    await searchableInput.waitFor({ state: "visible" });
    await page.waitForFunction(() => { const el = document.querySelector('input[aria-label="Search in this document"]'); return el && !el.disabled; }, { timeout: 5000 });
    await searchableInput.fill("drug");
    report.interactions.textSearchCount = await page.locator('[aria-live="polite"]').first().innerText();
    if (await page.getByRole("button", { name: "Next match" }).isEnabled()) {
      await page.getByRole("button", { name: "Next match" }).click();
      report.interactions.searchJump = true;
    }
  } catch { report.interactions.textSearch = "NOT VERIFIED: sampled document has no searchable text"; }
  await context.addCookies([
    { name: "horus_locale", value: "ar", url: baseURL },
  ]);
  for (const path of paths) {
    await page.goto(`${baseURL}${path}`, { waitUntil: "networkidle" });
    report.checks.push({
      path,
      width: 375,
      locale: "ar",
      rtl: (await page.locator("html").getAttribute("dir")) === "rtl",
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    });
    await page.screenshot({ path: `${output}/ar-${paths.indexOf(path)}-375.png`, fullPage: true });
  }
} catch (error) {
  report.blocker = error.message
    .replace(/https?:\/\/[^\s]+/g, "[URL]")
    .slice(0, 300);
} finally {
  writeFileSync(`${output}/${process.argv.includes("--quick") ? "final-phone-report" : "report"}.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      login: report.login,
      checks: report.checks.length,
      overflowCount: report.checks.filter((check) => check.overflow).length,
      interactions: report.interactions,
      consoleErrors: report.errors.length,
      failedRequests: report.failedRequests.length,
      blocker: report.blocker ?? null,
    }),
  );
  await browser.close();
}
