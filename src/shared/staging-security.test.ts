import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { validateStagingEnvironment } from "../../scripts/validate-staging-env.mjs";

const valid = () => ({ NODE_ENV: "production", VYLO_ENVIRONMENT: "staging",
  STAGING_DOMAIN: "staging.vylo.win", BETTER_AUTH_URL: "https://staging.vylo.win",
  BETTER_AUTH_SECRET: "unit-test-not-a-real-secret-0123456789",
  POSTGRES_PASSWORD: "unit-test-not-real", DATABASE_URL: "postgres://lms:unit-test-not-real@db:5432/lms",
  USE_HOSTED_AI: "false", STORAGE_DRIVER: "local", CONTENT_ROOT: "/data" });
describe("staging fail-closed configuration", () => {
  it("accepts an isolated HTTPS production-mode staging configuration", () => {
    expect(validateStagingEnvironment(valid())).toEqual([]);
  });
  it.each([
    ["NODE_ENV", "development"], ["VYLO_ENVIRONMENT", "production"],
    ["BETTER_AUTH_URL", "http://staging.vylo.win"], ["BETTER_AUTH_URL", "https://other.vylo.win"],
    ["BETTER_AUTH_URL", "https://staging.vylo.win/path"], ["BETTER_AUTH_TRUSTED_ORIGINS", "*"],
    ["BETTER_AUTH_TRUSTED_ORIGINS", "http://localhost:3000"], ["STAGING_DOMAIN", "localhost"],
    ["STAGING_DOMAIN", "127.0.0.1"], ["STAGING_DOMAIN", "staging.example.com"],
    ["BETTER_AUTH_SECRET", "build-only-placeholder-not-for-runtime"], ["BETTER_AUTH_SECRET", "short"],
    ["POSTGRES_PASSWORD", "REPLACE_ME"], ["DATABASE_URL", "postgres://lms:unit-test-not-real@localhost:5432/lms"],
    ["DATABASE_URL", "postgres://lms:wrong@db:5432/lms"], ["STORAGE_DRIVER", "s3"],
    ["CONTENT_ROOT", "public"], ["USE_HOSTED_AI", "yes"], ["GROQ_API_KEY", "unit-test-key"],
    ["PAYMOB_API_KEY", "unit-test-key"],
  ])("rejects unsafe %s without echoing values", (key, value) => {
    const errors = validateStagingEnvironment({ ...valid(), [key]: value });
    expect(errors.length).toBeGreaterThan(0);
    if (["BETTER_AUTH_SECRET", "POSTGRES_PASSWORD", "GROQ_API_KEY", "PAYMOB_API_KEY"].includes(key)) {
      expect(errors.join("\n")).not.toContain(value);
    }
  });
  it("rejects missing required settings", () => expect(validateStagingEnvironment({}).length).toBeGreaterThan(0));
  it("requires credentials for hosted AI opt-in", () => {
    expect(validateStagingEnvironment({ ...valid(), USE_HOSTED_AI: "true" }).length).toBeGreaterThan(0);
    expect(validateStagingEnvironment({ ...valid(), USE_HOSTED_AI: "true", GROQ_API_KEY: "unit-test-key" })).toEqual([]);
  });
});

describe("staging topology safeguards", () => {
  // js-yaml is already present through the locked ESLint dependency tree.
  const parse = createRequire(import.meta.url)("js-yaml").load as (text: string) => {
    name: string; services: Record<string, { ports?: string[]; command?: string[]; networks?: string[];
      environment?: Record<string, string>; build?: { target?: string }; depends_on?: Record<string, unknown> }>;
    networks: Record<string, { internal?: boolean } | null>;
  };
  const config = parse(readFileSync("docker-compose.staging.yml", "utf8"));
  it("publishes only the HTTPS edge, not Next.js or PostgreSQL", () => {
    expect(config.services.app.ports).toBeUndefined(); expect(config.services.db.ports).toBeUndefined();
    expect(config.services.proxy.ports).toEqual(["80:80", "443:443"]);
    expect(config.networks.database?.internal).toBe(true);
    expect(config.services.db.networks).toEqual(["database"]);
  });
  it("does not create a default migration/seed dependency chain", () => {
    expect(config.services.migrate).toBeUndefined(); expect(config.services.seed).toBeUndefined();
    expect(Object.keys(config.services.app.depends_on ?? {})).toEqual(["db"]);
    expect(config.name).toBe("lms-platform-staging");
  });
  it("uses the runner, production cookies mode and pre-start validator", () => {
    expect(config.services.app.build?.target).toBe("runner");
    expect(config.services.app.environment?.NODE_ENV).toBe("production");
    expect(config.services.app.command?.join(" ")).toContain("validate-staging-env.mjs && exec node server.js");
    expect(Object.keys(config.services.app.environment ?? {}).some(k => k.startsWith("PAYMOB_"))).toBe(false);
  });
  it("retains existing cookie protections and exact origin configuration", () => {
    const auth = readFileSync("src/shared/auth.ts", "utf8");
    expect(auth).toContain("useSecureCookies: isProduction");
    expect(auth).toContain('defaultCookieAttributes: { httpOnly: true, sameSite: "lax" }');
    expect(auth).toContain('const isProduction = process.env.NODE_ENV === "production"');
    expect(auth).toContain("baseURL,"); expect(auth).toContain("trustedOrigins,");
  });
  it("TLS edge has no public filesystem alias or cache policy override", () => {
    const edge = readFileSync("deploy/staging/Caddyfile", "utf8");
    expect(edge).toContain("{$STAGING_DOMAIN}"); expect(edge).toContain("reverse_proxy app:3000");
    expect(edge).toContain("header_up X-Forwarded-Proto https");
    expect(edge).not.toMatch(/file_server|Cache-Control|header_down|tls internal/);
  });
  it("does not deploy automatically when a branch is pushed", () => {
    const workflow = readFileSync(".github/workflows/deploy-staging.yml", "utf8");
    expect(workflow).not.toMatch(/\n\s+push:/); expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("config --quiet"); expect(workflow).not.toContain("image prune");
  });
});
