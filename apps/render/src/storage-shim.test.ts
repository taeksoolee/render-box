import { describe, expect, it } from "vitest";
import { injectStorageShim, shimInsertOffset, STORAGE_SHIM } from "./storage-shim";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("storage shim injection (design.md 5.4)", () => {
  it("goes right after <head>", () => {
    const out = dec(injectStorageShim(enc('<!DOCTYPE html><html><head lang="ko"><title>t</title>')));
    expect(out.startsWith(`<!DOCTYPE html><html><head lang="ko">${STORAGE_SHIM}<title>`)).toBe(true);
  });

  it("falls back to after the doctype, never before it", () => {
    const out = dec(injectStorageShim(enc("<!doctype html><p>hi</p>")));
    expect(out).toBe(`<!doctype html>${STORAGE_SHIM}<p>hi</p>`);
  });

  it("does not mistake <header> for <head>", () => {
    expect(shimInsertOffset(enc("<header>x</header>"))).toBe(0);
  });

  it("keeps multibyte content intact", () => {
    const html = "<head>한글 문서</head>";
    expect(dec(injectStorageShim(enc(html)))).toBe(`<head>${STORAGE_SHIM}한글 문서</head>`);
  });

  it("handles an empty document", () => {
    expect(dec(injectStorageShim(new Uint8Array()))).toBe(STORAGE_SHIM);
  });
});
