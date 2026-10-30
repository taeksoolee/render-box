import { describe, expect, it } from "vitest";
import { hmacSign, hmacVerify, randomBase62 } from "./crypto";
import { generateDocumentKey, isDocumentKey } from "./document-key";
import { isAllowedByFetchMetadata } from "./fetch-metadata";

describe("random identifiers", () => {
  it("document keys are 22 base62 chars", () => {
    for (let i = 0; i < 100; i++) expect(isDocumentKey(generateDocumentKey())).toBe(true);
    expect(isDocumentKey("__auth")).toBe(false);
  });

  it("base62 output has no obvious bias", () => {
    const counts = new Map<string, number>();
    for (const ch of randomBase62(62_000)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(62);
    for (const n of counts.values()) expect(n).toBeGreaterThan(800); // expected 1000
  });
});

describe("hmac", () => {
  it("verifies its own signatures and rejects tampering", async () => {
    const sig = await hmacSign("secret", "data");
    expect(await hmacVerify("secret", "data", sig)).toBe(true);
    expect(await hmacVerify("other", "data", sig)).toBe(false);
    expect(await hmacVerify("secret", "datA", sig)).toBe(false);
  });
});

describe("fetch metadata (design.md 3.6)", () => {
  const req = (method: string, headers: Record<string, string>) => new Request("https://a.test/", { method, headers });
  it("allows same-origin, direct navigation, missing headers, and top-level GET", () => {
    expect(isAllowedByFetchMetadata(req("GET", {}))).toBe(true);
    expect(isAllowedByFetchMetadata(req("POST", { "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isAllowedByFetchMetadata(req("GET", { "sec-fetch-site": "none" }))).toBe(true);
    expect(
      isAllowedByFetchMetadata(
        req("GET", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }),
      ),
    ).toBe(true);
  });
  it("rejects cross-site subresources and cross-site POST navigations", () => {
    expect(isAllowedByFetchMetadata(req("GET", { "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" }))).toBe(false);
    expect(isAllowedByFetchMetadata(req("GET", { "sec-fetch-site": "same-site", "sec-fetch-dest": "empty" }))).toBe(false);
    expect(
      isAllowedByFetchMetadata(
        req("POST", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }),
      ),
    ).toBe(false);
  });
});
