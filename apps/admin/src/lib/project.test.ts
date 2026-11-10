import { describe, expect, it } from "vitest";
import { pickProject } from "./project";

const p = (slug: string) => ({ projectId: slug.length, slug, name: slug, role: "EDITOR" as const });
const mine = [p("default"), p("tamna")];
const pick = (opts: Parameters<typeof pickProject>[1]) => pickProject(mine, opts).project?.slug ?? null;

describe("pickProject (design.md 3.9)", () => {
  it("prefers ?project=, then the cookie, then DEFAULT_PROJECT, then the first", () => {
    expect(pick({ query: "tamna", cookie: "default", fallback: "default" })).toBe("tamna");
    expect(pick({ cookie: "default", fallback: "tamna" })).toBe("default");
    expect(pick({ fallback: "tamna" })).toBe("tamna");
    expect(pick({})).toBe("default");
  });

  it("skips slugs the key is not in", () => {
    expect(pick({ query: "other", cookie: "nope", fallback: "secret" })).toBe("default");
    expect(pickProject(mine, { query: "other" }).fromQuery).toBe(false);
  });

  it("an empty DEFAULT_PROJECT means no default", () => {
    expect(pick({ fallback: "  " })).toBe("default");
  });

  it("has no project for a key in none", () => {
    expect(pickProject([], { fallback: "tamna" }).project).toBeNull();
  });
});
