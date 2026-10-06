import { pathToFileURL } from "node:url";

/** Read-only preflight. Errors name fields, never values. No DB/network IO. */
export function validateStagingEnvironment(env) {
  const errors = [];
  if (env.NODE_ENV !== "production") errors.push("NODE_ENV must be production");
  if (env.VYLO_ENVIRONMENT !== "staging") errors.push("VYLO_ENVIRONMENT must be staging");
  const domain = env.STAGING_DOMAIN ?? "";
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)
      || /\.(?:localhost|local|internal|test|invalid|example)$/i.test(domain)
      || /(?:^|\.)example\.(?:com|org|net)$/i.test(domain)) {
    errors.push("STAGING_DOMAIN must be an owner-controlled public staging DNS name");
  }
  try {
    const origin = new URL(env.BETTER_AUTH_URL);
    if (origin.protocol !== "https:" || origin.hostname !== domain || origin.port
        || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
      errors.push("BETTER_AUTH_URL must be the exact HTTPS staging origin");
    }
  } catch { errors.push("BETTER_AUTH_URL is required and must be valid"); }
  if ((env.BETTER_AUTH_TRUSTED_ORIGINS ?? env.BETTER_AUTH_URL) !== env.BETTER_AUTH_URL) {
    errors.push("BETTER_AUTH_TRUSTED_ORIGINS must equal the staging origin");
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || /REPLACE|CHANGE_ME|placeholder|build-only/i.test(env.BETTER_AUTH_SECRET)) {
    errors.push("BETTER_AUTH_SECRET must be a separate non-placeholder secret of at least 32 characters");
  }
  if (!env.POSTGRES_PASSWORD || /REPLACE|CHANGE_ME/i.test(env.POSTGRES_PASSWORD)) {
    errors.push("POSTGRES_PASSWORD must be a separate non-placeholder staging password");
  }
  try {
    const database = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== "db"
        || database.port !== "5432" || database.pathname !== "/lms" || database.username !== "lms"
        || database.search || database.hash || decodeURIComponent(database.password) !== env.POSTGRES_PASSWORD) {
      errors.push("DATABASE_URL must reference the private staging db service and matching credentials");
    }
  } catch { errors.push("DATABASE_URL is required and must be valid"); }
  for (const [name, value] of Object.entries(env)) {
    if (/^PAYMOB_/i.test(name) && value) errors.push("Payment credentials are forbidden in staging");
  }
  if (env.STORAGE_DRIVER !== "local" || env.CONTENT_ROOT !== "/data") {
    errors.push("Staging storage must use the approved read-only /data local mount");
  }
  if (!["true", "false"].includes(env.USE_HOSTED_AI ?? "false")) errors.push("USE_HOSTED_AI must be true or false");
  if (env.USE_HOSTED_AI !== "true" && env.GROQ_API_KEY) {
    errors.push("Leave GROQ_API_KEY absent unless hosted AI is explicitly enabled");
  }
  if (env.USE_HOSTED_AI === "true" && !env.GROQ_API_KEY) errors.push("Hosted AI opt-in requires its separate staging credential");
  return [...new Set(errors)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = validateStagingEnvironment(process.env);
  if (errors.length) {
    console.error("Staging startup blocked:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Staging environment validation passed (values not displayed)");
  }
}
