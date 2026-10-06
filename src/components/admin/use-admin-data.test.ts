import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Execute the real hook's callbacks with deterministic state/effect storage.
// No authentication, real network, React DOM, or database is bypassed.
const lifecycle = vi.hoisted(() => ({
  states: [] as unknown[],
  effect: null as (() => void | (() => void)) | null,
}));
vi.mock("react", () => ({
  useState: <T,>(initial: T) => {
    const index = lifecycle.states.push(initial) - 1;
    return [initial, (value: T) => { lifecycle.states[index] = value; }];
  },
  useRef: <T,>(initial: T) => ({ current: initial }),
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { lifecycle.effect = effect; },
}));
import { fetchAdminJson, useAdminData } from "./use-admin-data";

const views = ["overview", "users", "subscriptions", "content", "learning", "quiz",
  "practical", "ospe", "review", "ai", "xp", "activity", "payments", "audit", "system"];
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function Mount(view = "overview") {
  const hook = useAdminData(view);
  const cleanup = lifecycle.effect!();
  return { hook, cleanup };
}
beforeEach(() => {
  lifecycle.states = [];
  lifecycle.effect = null;
  vi.useFakeTimers();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("admin data loading lifecycle", () => {
  for (const view of views) {
    it(`${view}: successful JSON leaves loading and exposes the payload`, async () => {
      const payload = { view, rows: [] };
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
      vi.stubGlobal("fetch", fetcher);
      Mount(view);
      await settle();
      expect(fetcher.mock.calls[0][0]).toBe(`/api/admin/analytics?view=${view}`);
      expect(lifecycle.states).toEqual([payload, false, null]);
    });
  }
  for (const status of [401, 403, 500, 504]) {
    it(`HTTP ${status} settles into a safe error, not an endless spinner`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private SQL/stack detail", { status })));
      Mount();
      await settle();
      expect(lifecycle.states).toEqual([null, false, status === 504 ? "timeout" : `HTTP ${status}`]);
    });
  }
  it("network failure settles without exposing internal errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private filesystem/SQL")));
    Mount(); await settle();
    expect(lifecycle.states).toEqual([null, false, "network_error"]);
  });
  it("malformed JSON settles into an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    Mount(); await settle();
    expect(lifecycle.states).toEqual([null, false, "network_error"]);
  });
  it("timeout settles a hanging request", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    Mount(); await vi.advanceTimersByTimeAsync(20000); await settle();
    expect(lifecycle.states).toEqual([null, false, "timeout"]);
  });
  it("cleanup aborts its request and prevents later state writes", async () => {
    const fetcher = vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetcher);
    const { cleanup } = Mount();
    cleanup?.(); await settle();
    expect(fetcher.mock.calls[0][1].signal!.aborted).toBe(true);
    expect(lifecycle.states).toEqual([null, true, null]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("effect cleanup/restart does not let an obsolete response overwrite the current one", async () => {
    const responses: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => responses.push(resolve))));
    const { cleanup } = Mount();
    cleanup?.();
    const secondCleanup = lifecycle.effect!();
    responses[1](new Response('{"current":true}')); await settle();
    responses[0](new Response('{"obsolete":true}')); await settle();
    expect(lifecycle.states).toEqual([{ current: true }, false, null]);
    secondCleanup?.();
  });
  it("retry recovers after an error", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(new Response('{"restored":true}'));
    vi.stubGlobal("fetch", fetcher);
    const { hook } = Mount(); await settle();
    hook.reload(); await settle();
    expect(lifecycle.states).toEqual([{ restored: true }, false, null]);
  });
});

describe("management read safety", () => {
  it("returns empty collections and clears its timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"modules":[]}')));
    await expect(fetchAdminJson("/api/admin/modules")).resolves.toEqual({ modules: [] });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not show private server errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private SQL details", { status: 500 })));
    await expect(fetchAdminJson("/api/admin/lectures")).rejects.toThrow("HTTP 500");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("normalizes rejected network requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret internal path")));
    await expect(fetchAdminJson("/api/admin/academic-periods")).rejects.toThrow("network_error");
  });
  it("normalizes malformed JSON instead of hanging", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(fetchAdminJson("/api/admin/redeem-codes")).rejects.toThrow("network_error");
  });
  it("aborts a pending management request on its deadline", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const assertion = expect(fetchAdminJson("/api/admin/promo-codes")).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
  });
});
