import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("OSPE static-PDF protection", () => {
  it("blocks a direct public OSPE PDF URL before static-file serving", () => {
    const response = proxy(new NextRequest("http://localhost/ospe-pdfs/OSPE%20CVS.pdf"));
    expect(response.status).toBe(404);
  });

  it("blocks a direct public study-card URL", () => {
    const response = proxy(new NextRequest("http://localhost/study-cards/ahe-101-anatomy-cvs.svg"));
    expect(response.status).toBe(404);
  });
});
