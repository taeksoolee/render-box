import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

const APP = "https://admin.example.dev";
const ok = (v: string) => safeRedirectPath(v, APP, ["/html", "/auth/render"]);

describe("safeRedirectPath (design.md 3.7)", () => {
  it("accepts same-origin paths under allowed prefixes", () => {
    expect(ok("/html")).toBe("/html");
    expect(ok("/html/abc?saved=1")).toBe("/html/abc?saved=1");
    expect(ok("/auth/render?next=%2Fabc")).toBe("/auth/render?next=%2Fabc");
    expect(ok(`${APP}/html`)).toBe("/html");
  });

  it.each([
    "//evil.com",
    "/%09/evil.com",
    "/\t/evil.com",
    "/\\evil.com",
    "https://evil.com/html",
    "javascript:alert(1)",
    "/htmlx",
    "/login",
    "",
  ])("rejects %j", (value) => {
    expect(ok(value)).toBeNull();
  });
});
