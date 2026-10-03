import { describe, expect, it, vi } from "vitest";
import { readBoundedJson, RequestBodyTooLarge } from "./bounded-json";

describe("bounded JSON request parsing", () => {
  it("parses an ordinary JSON request", async () => {
    expect(await readBoundedJson(new Request("http://localhost", { method: "POST", body: '{"x":1}' }), 20)).toEqual({ x: 1 });
  });
  it("denies a declared oversize body before reading", async () => {
    const request = new Request("http://localhost", { method: "POST", body: "{}", headers: { "Content-Length": "100" } });
    await expect(readBoundedJson(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    expect(request.bodyUsed).toBe(false);
  });
  it("enforces actual bytes even with a false small Content-Length", async () => {
    const request = new Request("http://localhost", { method: "POST", body: '"' + "أ".repeat(10) + '"', headers: { "Content-Length": "2" } });
    await expect(readBoundedJson(request, 15)).rejects.toBeInstanceOf(RequestBodyTooLarge);
  });
  it("cancels an oversized chunked stream without Content-Length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel });
    const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readBoundedJson(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLarge);
    expect(cancel).toHaveBeenCalled();
  });
  it("invalid JSON is still denied", async () => {
    await expect(readBoundedJson(new Request("http://localhost", { method: "POST", body: "invalid" }), 20)).rejects.toBeInstanceOf(SyntaxError);
  });
});
