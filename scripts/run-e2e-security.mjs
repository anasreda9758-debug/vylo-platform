/**
 * Isolated runner for e2e-security.mjs.
 *
 * It clones the currently stopped development database into a uniquely named
 * disposable database, launches Next against that copy, then forcibly removes
 * only that copy. It refuses to run if the source has other connections, which
 * prevents a test from ever competing with a developer using the real data.
 */
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import postgres from "postgres";

const sourceUrl = new URL(process.env.DATABASE_URL ?? "");
const sourceDatabase = decodeURIComponent(sourceUrl.pathname.slice(1));
if (!/^[a-zA-Z0-9_]+$/.test(sourceDatabase)) throw new Error("DATABASE_URL must name a simple local database");
if (sourceDatabase.toLowerCase().startsWith("horus_e2e_")) throw new Error("DATABASE_URL must be the development source, never an E2E copy");

const testDatabase = `horus_e2e_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${testDatabase}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
// Keep this separate from the developer's normal localhost:3000 server. The
// isolated process explicitly receives this URL as Better Auth's base URL.
const port = Number(process.env.E2E_PORT ?? 3101);
const baseUrl = `http://127.0.0.1:${port}`;
const adminSql = postgres(adminUrl.toString(), { max: 1 });
let app;
let testCreated = false;
let appOutput = "";

function safeIdentifier(identifier) {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) throw new Error(`Unsafe database identifier: ${identifier}`);
  return `"${identifier}"`;
}

async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  let lastError = "unknown error";
  while (Date.now() < deadline) {
    if (app?.exitCode !== null) {
      throw new Error(`Test application exited before becoming healthy: ${appOutput.slice(-4000)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Test application did not become healthy: ${lastError}`);
}

async function assertPortIsAvailable() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Refusing to run: port ${port} is already in use`)));
    // Omit the host so the probe detects both IPv4 and IPv6 listeners, matching
    // Next's default bind behaviour on Windows.
    probe.listen(port, () => probe.close(resolve));
  });
}

function stopApp() {
  if (process.platform === "win32") {
    // Next's Windows launcher can fork and exit before the dev server itself.
    // The port was proven free before this runner started, so this can only
    // terminate the isolated server that this runner launched on E2E_PORT.
    const command = `$listeners = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue; foreach ($listener in $listeners) { Stop-Process -Id $listener.OwningProcess -Force }`;
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { stdio: "ignore", windowsHide: true });
  } else if (app && app.exitCode === null) {
    app.kill("SIGTERM");
  }
}

try {
  await assertPortIsAvailable();
  const activeConnections = await adminSql`
    select count(*)::int as count
    from pg_stat_activity
    where datname = ${sourceDatabase} and pid <> pg_backend_pid()
  `;
  if (activeConnections[0].count !== 0) {
    throw new Error(`Refusing to clone ${sourceDatabase}: ${activeConnections[0].count} other connection(s) are active`);
  }

  await adminSql.unsafe(`create database ${safeIdentifier(testDatabase)} template ${safeIdentifier(sourceDatabase)}`);
  testCreated = true;
  console.log(`[e2e-security] created isolated database ${testDatabase}`);

  // Start Next through the Node executable rather than npm.cmd. This makes the
  // launched process a direct child on Windows, so cleanup cannot leave an
  // orphaned server pointed at a database that has just been removed.
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      BETTER_AUTH_URL: baseUrl,
      E2E_SECURITY_TEST: "true",
      USE_HOSTED_AI: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  app.stdout.on("data", (chunk) => { appOutput += String(chunk); });
  app.stdout.on("data", (chunk) => process.stdout.write(chunk));
  app.stderr.on("data", (chunk) => {
    appOutput += String(chunk);
    process.stderr.write(chunk);
  });
  await waitForHealth().catch((error) => { throw new Error(`${error.message}\n${appOutput.slice(-4000)}`); });

  const testProcess = spawn(process.execPath, ["scripts/e2e-security.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, E2E_BASE_URL: baseUrl, E2E_DATABASE_URL: testUrl.toString(), USE_HOSTED_AI: "false" },
    stdio: "inherit",
    windowsHide: true,
  });
  const result = await new Promise((resolve, reject) => {
    testProcess.once("error", reject);
    testProcess.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0) throw new Error(`Security suite failed with code ${result.code ?? "null"}${result.signal ? ` (${result.signal})` : ""}`);
} finally {
  stopApp();
  if (testCreated) {
    // Explicitly terminate only test-copy sessions before dropping that exact copy.
    await adminSql`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${testDatabase}`.catch(() => {});
    await adminSql.unsafe(`drop database if exists ${safeIdentifier(testDatabase)}`).catch((error) => {
      console.error(`[e2e-security] could not remove ${testDatabase}:`, error);
      process.exitCode = 1;
    });
    console.log(`[e2e-security] removed isolated database ${testDatabase}`);
  }
  await adminSql.end({ timeout: 5 }).catch(() => {});
}
