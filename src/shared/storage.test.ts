import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const mocks = vi.hoisted(() => ({ stat: vi.fn(), send: vi.fn() }));
vi.mock("node:fs/promises", () => ({ stat: mocks.stat, readFile: vi.fn() }));
vi.mock("node:fs", () => ({ createReadStream: () => {
  const stream = Object.assign(new EventEmitter(), { destroy: vi.fn() });
  queueMicrotask(() => { stream.emit("data", Buffer.from("mock PDF")); stream.emit("end"); });
  return stream;
} }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = mocks.send; },
  HeadObjectCommand: class {}, GetObjectCommand: class {},
}));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("CONTENT_ROOT", "C:/unit-test-content");
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 8, mtime: new Date(0) });
  mocks.send.mockResolvedValue({ ContentLength: 8, ContentType: "application/pdf", Body: {
    transformToWebStream: () => new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("mock PDF")); controller.close();
    } }),
  } });
});
afterEach(() => vi.unstubAllEnvs());
describe("protected storage response defaults", () => {
  it.each(["local", "s3"])("%s driver is never publicly cacheable", async (driver) => {
    vi.stubEnv("STORAGE_DRIVER", driver);
    const { streamFile } = await import("./storage");
    const response = await streamFile("lectures/mock.pdf");
    expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response?.headers.get("Vary")).toBe("Cookie, Authorization");
    expect(response?.headers.get("Content-Type")).toBe("application/pdf");
    expect(await response?.text()).toBe("mock PDF");
  });
  it("local traversal cannot access files outside the configured root", async () => {
    vi.stubEnv("STORAGE_DRIVER", "local");
    const { streamFile } = await import("./storage");
    expect(await streamFile("../outside.pdf")).toBeNull();
    expect(mocks.stat).not.toHaveBeenCalled();
  });
  it.each(["ospe-pdfs/mock.pdf", "study-cards/mock.svg"])("existing static proxy denies %s", (path) => {
    expect(proxy(new NextRequest(`http://localhost/${path}`)).status).toBe(404);
  });
});
