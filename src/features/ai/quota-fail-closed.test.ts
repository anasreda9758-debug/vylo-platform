import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn(), legacy: vi.fn() }));
vi.mock("@/shared/db", () => ({ db: { transaction: mocks.transaction, select: mocks.legacy } }));
import { reserveAiUsageSlot } from "./queries";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (fn) => fn({ execute: mocks.execute }));
});
describe("hosted quota fails closed", () => {
  it.each([
    Object.assign(new Error('relation "ai_usage_daily" does not exist'), { code: "42P01" }),
    new Error("DB connection failed"),
  ])("missing counter/DB failure cannot grant an unreserved slot", async (error) => {
    mocks.transaction.mockRejectedValue(error);
    await expect(reserveAiUsageSlot("actor")).rejects.toThrow();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it.each([undefined, "14", -1, NaN, 1.5])("invalid counter %s cannot fail open", async (count) => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count }]);
    await expect(reserveAiUsageSlot("actor")).rejects.toThrow("Invalid AI quota counter");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("requires a confirmed increment or rolls back via the transaction exception", async () => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(reserveAiUsageSlot("actor")).rejects.toThrow("reservation was not confirmed");
  });
  it.each([0, 16, Infinity, 1.5])("invalid/uncapped limit %s is rejected", async (limit) => {
    await expect(reserveAiUsageSlot("actor", limit)).rejects.toThrow("Invalid AI quota limit");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
