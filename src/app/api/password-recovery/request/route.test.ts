import { describe, expect, it, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createChallenge: vi.fn(async (_email: string, ip: string) => {
    return { limited: false, challengeId: "ch-1", requestIp: ip };
  }),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/auth/password-recovery", () => ({
  createPasswordResetChallenge: mocks.createChallenge,
  PASSWORD_RESET_MESSAGE: "check your email",
}));
vi.mock("@/shared/logger", () => ({ logger: { info: mocks.info, error: mocks.error } }));

import { POST } from "./route";

const originalTrustProxy = process.env.TRUST_PROXY;

afterEach(() => {
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = originalTrustProxy;
  vi.clearAllMocks();
});

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/password-recovery/request", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "student@test.horus.edu.eg" }),
  });

describe("POST /api/password-recovery/request", () => {
  it("does not trust proxy-supplied IPs unless TRUST_PROXY is explicitly enabled", async () => {
    delete process.env.TRUST_PROXY;
    const res = await POST(req({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" }));
    expect(res.status).toBe(200);
    expect(mocks.createChallenge).toHaveBeenCalledWith(expect.any(String), "unknown");
  });

  it("honors x-forwarded-for only with TRUST_PROXY=true", async () => {
    process.env.TRUST_PROXY = "true";
    const res = await POST(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }));
    expect(res.status).toBe(200);
    expect(mocks.createChallenge).toHaveBeenCalledWith(expect.any(String), "1.2.3.4");
  });

  it("keeps the public response generic even for malformed JSON", async () => {
    const res = await POST(new Request("http://localhost/api/password-recovery/request", {
      method: "POST",
      body: "{broken",
    }));
    expect(res.status).toBe(200);
    expect(mocks.createChallenge).not.toHaveBeenCalled();
  });
});