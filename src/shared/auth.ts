import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { db } from "./db";
import * as schema from "../db/schema";

function exactOrigin(value: string | undefined) {
  if (!value || value.includes("*")) return null;
  try {
    const origin = new URL(value).origin;
    return /^https?:\/\//.test(origin) ? origin : null;
  } catch {
    return null;
  }
}

const baseURL = exactOrigin(process.env.BETTER_AUTH_URL) ?? "http://localhost:3000";
const configuredTrustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => exactOrigin(origin.trim()))
  .filter((origin): origin is string => Boolean(origin));
const trustedOrigins = [
  baseURL,
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
  ...configuredTrustedOrigins,
].filter((origin, index, origins) => origins.indexOf(origin) === index);

async function sendVYLOEmail(data: {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Email provider is not configured");
  const isVerification = data.type === "email-verification";
  const subject = isVerification ? "Verify your VYLO email" : "VYLO verification code";
  const text = isVerification
    ? [
        "VYLO",
        "",
        "مرحبًا بك في VYLO",
        "",
        "رمز تأكيد بريدك الإلكتروني:",
        data.otp,
        "",
        "الرمز صالح لمدة 10 دقائق.",
        "",
        "إذا لم تقم بإنشاء حساب VYLO، تجاهل هذه الرسالة.",
      ].join("\n")
    : `VYLO verification code: ${data.otp}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.7;max-width:520px;margin:auto">
      <h1 style="color:#0f766e">VYLO</h1>
      ${isVerification ? "<p>مرحبًا بك في VYLO</p><p>رمز تأكيد بريدك الإلكتروني:</p>" : "<p>رمز التحقق الخاص بك:</p>"}
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0f766e">${data.otp}</p>
      <p>الرمز صالح لمدة 10 دقائق.</p>
      ${isVerification ? "<p>إذا لم تقم بإنشاء حساب VYLO، تجاهل هذه الرسالة.</p>" : ""}
    </div>
  `;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [data.email], subject, text, html }),
  });
  if (!response.ok) throw new Error(`Verification email failed (${response.status})`);
}

export const auth = betterAuth({
  baseURL,
  trustedOrigins,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      // Do not include the email, password, or reset token in audit logs.
      const { logger } = await import("./logger");
      logger.info({ event: "PASSWORD_RESET_COMPLETED", userId: user.id }, "Better Auth password reset completed");
    },
    emailVerification: {
      sendOnSignIn: true,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "student",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // sliding renewal daily
  },
  advanced: {
    cookiePrefix: "lms",
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/*": { window: 60, max: 30 },
        "/sign-up/*": { window: 60, max: 20 },
        "/change-password/*": { window: 60, max: 10 },
        "/change-email/*": { window: 60, max: 10 },
      },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      storeOTP: "hashed",
      resendStrategy: "rotate",
      overrideDefaultEmailVerification: true,
      rateLimit: { window: 60, max: 1 },
      sendVerificationOTP: sendVYLOEmail,
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
export type ActiveUser = typeof auth.$Infer.Session.user;
