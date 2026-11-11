import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRAME_ACCESS, findFrameAccess, htmlWarnings } from "../src/warnings";

describe("frame access warning (design.md 4.6)", () => {
  it.each([
    ["fr.contentDocument", "const d=fr.contentDocument;"],
    ["fr.contentWindow.document", "const dd = fr.contentWindow . document;"],
    ["frames[0].document", "window.frames[0].document.body"],
    ["frames.view.document", "frames.view.document"],
    ["parent.document", "window.parent.document.title='x'"],
    ["top.document", "top.document.body"],
    ["opener.document", "opener.document"],
    [".contentDocument", "$('#f')[0].contentDocument"],
  ])("finds %s", (expected, code) => {
    expect(findFrameAccess(`<script>${code}</script>`)).toEqual([expected]);
  });

  it.each([
    "fr.contentWindow.postMessage({}, '*')",
    "document.getElementById('x')",
    "const parentDocument = 1; documents.top",
    "<p>contentDocuments are cool</p>",
  ])("leaves alone %s", (code) => {
    expect(findFrameAccess(code)).toEqual([]);
  });

  it("gives at most three distinct examples", () => {
    const html = "a.contentDocument b.contentDocument a.contentDocument c.contentDocument top.document";
    expect(htmlWarnings(html)).toEqual([
      expect.objectContaining({ code: "frame_access", examples: ["a.contentDocument", "b.contentDocument", "c.contentDocument"] }),
    ]);
    expect(htmlWarnings("<p>ok</p>")).toEqual([]);
  });

  it("app.js uses the same pattern", () => {
    const appJs = readFileSync(new URL("../../../apps/admin/public/static/js/app.js", import.meta.url), "utf8");
    const m = /var FRAME_ACCESS = (\/.*\/g);/.exec(appJs);
    expect(m?.[1]).toBe(String(FRAME_ACCESS));
  });
});
