import { describe, expect, it, vi } from "vitest";
import {
  cairoDateStr,
  startOfCairoDay,
  parseRangeKey,
  resolveRange,
  toCsv,
  csvFilename,
  gradeSeverity,
  sanitizeEnv,
  parseUserSort,
  tsParam,
  toDate,
} from "@/features/admin/analytics";

vi.mock("@/shared/db", () => ({
  db: {
    execute: vi.fn(async () => []),
    query: {},
    select: {},
  },
}));

describe("cairoDateStr / startOfCairoDay", () => {
  it("formats a fixed instant as its Cairo calendar day", () => {
    // 2026-01-15T22:30:00Z is 2026-01-16 00:30 in Cairo (+02:00 winter).
    const d = new Date("2026-01-15T22:30:00Z");
    expect(cairoDateStr(d)).toBe("2026-01-16");
  });

  it("startOfCairoDay points at 00:00 local Cairo of that day", () => {
    const start = startOfCairoDay(new Date("2026-01-15T22:30:00Z"));
    expect(cairoDateStr(start)).toBe("2026-01-16");
    expect(start.toISOString()).toBe("2026-01-15T22:00:00.000Z");
  });
});

describe("parseRangeKey", () => {
  it("accepts known keys, otherwise defaults to 30d", () => {
    expect(parseRangeKey("today")).toBe("today");
    expect(parseRangeKey("90d")).toBe("90d");
    expect(parseRangeKey("this_term")).toBe("this_term");
    expect(parseRangeKey(null)).toBe("30d");
    expect(parseRangeKey("bogus")).toBe("30d");
  });
});

describe("resolveRange", () => {
  const NOW = new Date("2026-02-05T12:00:00.000Z");

  it("today: spans the full Cairo calendar day (UTC equivalents)", async () => {
    const r = await resolveRange("today", { now: NOW });
    // Cairo is UTC+2 in winter: local midnight = 22:00 the previous UTC day
    expect(r.since?.toISOString()).toBe("2026-02-04T22:00:00.000Z");
    expect(r.until?.toISOString()).toBe("2026-02-05T22:00:00.000Z");
    expect(r.cairoSince).toBe("2026-02-05");
    expect(r.cairoUntil).toBe("2026-02-05");
  });

  it("30d: includes 30 Cairo calendar days ending today", async () => {
    const r = await resolveRange("30d", { now: NOW });
    expect(r.cairoSince).toBe("2026-01-07");
    expect(r.cairoUntil).toBe("2026-02-05");
    expect(r.until).not.toBeNull();
  });

  it("this_term: uses the injected active period without touching the DB", async () => {
    const period = { startsAt: new Date("2026-01-15T08:00:00.000Z"), endsAt: new Date("2026-04-30T08:00:00.000Z") };
    const r = await resolveRange("this_term", { now: NOW, activePeriod: period });
    expect(r.since?.toISOString()).toBe("2026-01-15T08:00:00.000Z");
    // end-of-day inclusive upper bound
    expect(r.until?.getTime()).toBe(period.endsAt.getTime() + 86_400_000);
    expect(r.label).toBe("الفصل الدراسي");
  });

  it("custom: invalid dates produce no bounds rather than guessing", async () => {
    const r = await resolveRange("custom", { from: "not-a-date", to: "2026-02-10" });
    expect(r.since).toBeNull();
    expect(r.until).toBeNull();
  });
});

describe("gradeSeverity", () => {
  it("classes counts against a threshold", () => {
    expect(gradeSeverity(1, 3)).toBe("INFO");
    expect(gradeSeverity(3, 3)).toBe("WARNING");
    expect(gradeSeverity(6, 3)).toBe("CRITICAL");
  });
});

describe("parseUserSort", () => {
  it("whitelists sorts and falls back to created_at", () => {
    expect(parseUserSort("lectures")).toBe("lectures");
    expect(parseUserSort("quizzes")).toBe("quizzes");
    expect(parseUserSort("xp")).toBe("xp");
    expect(parseUserSort("anything")).toBe("created_at");
  });
});

describe("sanitizeEnv", () => {
  it("never leaks secret values — only presence booleans and safe fields", () => {
    const out = sanitizeEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_BASE_URL: "https://vylo.example",
      GROQ_API_KEY: "GROQ_SECRET_ABCD",
      RESEND_API_KEY: "RESEND_SECRET_XY",
      PAYMOB_API_KEY: "pk_test_123",
      PAYMOB_INTEGRATION_ID: "12345",
      PAYMOB_HMAC_SECRET: "hmac_super_secret",
      AI_COST_PER_1M_INPUT: "1.5",
    });
    expect(out.env.nodeEnv).toBe("production");
    expect(out.env.baseUrlSet).toBe(true);
    expect(out.integrations.ai.groqKeySet).toBe(true);
    expect(out.integrations.email.resendKeySet).toBe(true);
    expect(out.integrations.payments.enabled).toBe(true);
    expect(JSON.stringify(out)).not.toContain("GROQ_SECRET_ABCD");
    expect(JSON.stringify(out)).not.toContain("RESEND_SECRET_XY");
    expect(JSON.stringify(out)).not.toContain("pk_test_123");
    expect(JSON.stringify(out)).not.toContain("hmac_super_secret");
    expect(JSON.stringify(out)).not.toContain("1.5");
  });

  it("payments enabled requires all three keys", () => {
    const missingHmac = sanitizeEnv({ PAYMOB_API_KEY: "x", PAYMOB_INTEGRATION_ID: "y", PAYMOB_HMAC_SECRET: "" });
    expect(missingHmac.integrations.payments.enabled).toBe(false);
  });
});

describe("toCsv", () => {
  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const csv = toCsv([{ name: 'Ali, "the great"', note: "line1\nline2", empty: null }], [
      { key: "name", label: "Name" },
      { key: "note", label: "Note" },
      { key: "empty", label: "Empty" },
    ]);
    expect(csv).toBe('Name,Note,Empty\n"Ali, ""the great""","line1\nline2",');
  });

  it("generates a header from keys when no columns are supplied", () => {
    const csv = toCsv([{ studyYear: 4, lectures: 12 }]);
    expect(csv.split("\n")[0]).toBe("Study Year,Lectures");
  });

  it("returns empty string for empty rows without explicit columns", () => {
    expect(toCsv([])).toBe("");
  });
});

describe("csvFilename", () => {
  it("prefixes with the Cairo date", () => {
    const name = csvFilename("users");
    expect(name).toMatch(/^users-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

/**
 * Regression cover for the three runtime defects found during end-to-end
 * verification against the live dev database. Each of these returned HTTP 500
 * on a real /admin request.
 */
describe("tsParam — Date bind parameters (regression)", () => {
  it("emits a naive `YYYY-MM-DD HH:MM:SS` literal, never a Date object", () => {
    const out = tsParam(new Date("2026-09-26T21:00:00.000Z"));
    expect(typeof out).toBe("string");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(out).not.toContain("Z");
    expect(out).not.toContain("+");
  });

  it("renders Cairo midnight as 00:00:00 on the Cairo calendar day", () => {
    // startOfCairoDay() yields the instant of Cairo 00:00; tsParam must render
    // that as Cairo wall-clock midnight, which is what `timestamp without time
    // zone` columns store.
    expect(tsParam(startOfCairoDay(new Date("2026-09-26T21:00:00.000Z")))).toBe("2026-09-27 00:00:00");
  });

  it("does not shift the boundary the way toISOString() would", () => {
    const d = new Date("2026-09-26T21:00:00.000Z");
    // toISOString() carries Z, which PostgreSQL re-interprets in the session
    // timezone — this is precisely the bug tsParam exists to avoid.
    expect(d.toISOString()).not.toBe(tsParam(d));
  });
});

describe("toDate — DB timestamp coercion (regression)", () => {
  it("accepts a Date unchanged", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(toDate(d)?.toISOString()).toBe(d.toISOString());
  });

  it("parses the naive strings drizzle actually returns for timestamp columns", () => {
    // Drizzle returns `timestamp without time zone` as e.g. '2027-07-01 00:00:00'.
    // This is the exact shape that made range=this_term throw
    // `period.endsAt.getTime is not a function`.
    const parsed = toDate("2027-07-01 00:00:00");
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.getTime()).toBe(startOfCairoDay(new Date("2027-06-30T21:00:00.000Z")).getTime());
  });

  it("respects an explicit offset when present", () => {
    expect(toDate("2026-09-26T21:00:00.000Z")?.toISOString()).toBe("2026-09-26T21:00:00.000Z");
  });

  it("returns null for null/undefined/garbage instead of throwing", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("")).toBeNull();
    expect(toDate("   ")).toBeNull();
    expect(toDate({})).toBeNull();
  });

  it("keeps a millisecond-precision naive timestamp usable", () => {
    expect(toDate("2026-09-14 16:07:44.757")?.getMilliseconds()).toBe(757);
  });
});

describe("resolveRange this_term does not throw on driver-shaped rows (regression)", () => {
  it("resolves an active period whose bounds arrive as naive strings", async () => {
    const r = await resolveRange("this_term", {
      activePeriod: { startsAt: new Date("2026-08-31T21:00:00.000Z"), endsAt: new Date("2027-02-28T21:59:59.999Z") },
    });
    expect(r.key).toBe("this_term");
    expect(r.since).toBeInstanceOf(Date);
    expect(r.until).toBeInstanceOf(Date);
    expect(cairoDateStr(r.since as Date)).toBe("2026-09-01");
  });

  it("tolerates a null ends_at", async () => {
    const r = await resolveRange("this_term", {
      activePeriod: { startsAt: new Date("2026-08-31T21:00:00.000Z"), endsAt: null },
    });
    expect(r.since).toBeInstanceOf(Date);
    expect(r.until).toBeNull();
  });
});

/**
 * `ospe_answer_key` holds the answer/diagnosis for each station IMAGE. It is
 * reference data, NOT a configured student station. Reporting it as
 * "stations configured" overstated readiness by 759 while the real binding
 * table was empty.
 */
describe("OSPE station semantics (regression)", () => {
  const asMock = async () => {
    const { db } = await import("@/shared/db");
    return db.execute as unknown as ReturnType<typeof vi.fn>;
  };

  it("counts configured stations from practical_track_ospe_station, not ospe_answer_key", async () => {
    const execute = await asMock();
    execute.mockImplementation(async (q: unknown) => {
      const sqlText = JSON.stringify(q);
      if (sqlText.includes("ospe_answer_key")) return [{ total: 759, folders: 4 }];
      if (sqlText.includes("practical_track_ospe_station") && !sqlText.includes("count(*) FROM practical_track_ospe_station pto")) {
        return [{ total: 0 }];
      }
      return [];
    });

    const { getOspeAnalytics } = await import("@/features/admin/analytics");
    const res = await getOspeAnalytics({ key: "30d", since: null, until: null, cairoSince: null, cairoUntil: null, label: "x" });

    expect(res.stationsConfigured).toBe(0);
    expect(res.answerKeyEntries).toBe(759);
    expect(res.answerKeyFolders).toBe(4);
  });

  it("the zero-station warning keys off real configured stations", async () => {
    const execute = await asMock();
    execute.mockImplementation(async (q: unknown) => {
      const sqlText = JSON.stringify(q);
      // Real binding count is 0 even though 759 answer keys exist.
      if (sqlText.includes("AS stations")) return [{ stations: 0, tracks: 1 }];
      if (sqlText.includes("ospe_answer_key")) return [{ c: 759 }];
      return [];
    });

    const { getAttentionWarnings } = await import("@/features/admin/analytics");
    const warnings = await getAttentionWarnings({ key: "30d", since: null, until: null, cairoSince: null, cairoUntil: null, label: "x" });

    expect(warnings.map((w) => w.id)).toContain("ospe-zero-stations");
  });
});