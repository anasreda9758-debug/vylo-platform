import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ plan: vi.fn(), summer: vi.fn(), module: vi.fn(), price: vi.fn(), summerPrice: vi.fn(), session: vi.fn() }));
vi.mock("@/shared/session", () => ({ getSession: mocks.session }));
vi.mock("@/features/hierarchy/academic-visibility-server", () => ({ isPlanAcademicallyVisible: mocks.plan, isSummerAcademicallyVisible: mocks.summer, isModuleAcademicallyVisible: mocks.module }));
vi.mock("@/features/billing/pricing", () => ({ calculatePricePreview: mocks.price, PromoValidationError: class extends Error {} }));
vi.mock("@/features/billing/summer-pricing", () => ({ calculateSummerPreview: mocks.summerPrice }));
import { POST as pricePreview } from "@/app/api/billing/price-preview/route";
import { POST as summerPreview } from "@/app/api/billing/summer-preview/route";
const request = (body: unknown) => ({ json: async () => body }) as never;
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { id: "student", role: "student" } }); });
describe("price-discovery URLs cannot bypass academic visibility", () => {
  it("denies a future plan before calculating/returning price metadata", async () => {
    mocks.plan.mockResolvedValue(false);
    expect((await pricePreview(request({ planId: "future" }))).status).toBe(404);
    expect(mocks.price).not.toHaveBeenCalled();
  });
  it("visible pricing preserves the unchanged calculation", async () => {
    mocks.plan.mockResolvedValue(true);
    mocks.price.mockResolvedValue({ finalPriceCents: 14900 });
    const response = await pricePreview(request({ planId: "current" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ finalPriceCents: 14900 });
  });
  it("Summer preview is unavailable outside the configured Summer window", async () => {
    mocks.summer.mockResolvedValue(false);
    expect((await summerPreview(request({ moduleIds: ["module"] }))).status).toBe(404);
    expect(mocks.summerPrice).not.toHaveBeenCalled();
  });
  it("active Summer cannot reveal a future/unassociated module via IDs", async () => {
    mocks.summer.mockResolvedValue(true);
    mocks.module.mockResolvedValue(false);
    expect((await summerPreview(request({ moduleIds: ["future"] }))).status).toBe(404);
    expect(mocks.summerPrice).not.toHaveBeenCalled();
  });
});
