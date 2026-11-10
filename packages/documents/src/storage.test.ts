import { describe, expect, it } from "vitest";
import { storageLimits } from "./storage";

const MB = 1024 * 1024;

describe("storage limits (design.md 4.9)", () => {
  it("defaults to 400MB with a warning at 80%", () => {
    expect(storageLimits({})).toEqual({ limit: 400 * MB, warnAt: 320 * MB });
  });

  it("reads STORAGE_LIMIT_MB and STORAGE_WARN_PERCENT", () => {
    expect(storageLimits({ STORAGE_LIMIT_MB: "8000", STORAGE_WARN_PERCENT: "90" })).toEqual({
      limit: 8000 * MB,
      warnAt: 7200 * MB,
    });
  });

  it.each(["", "abc", "0", "-5"])("falls back to defaults for %j", (bad) => {
    expect(storageLimits({ STORAGE_LIMIT_MB: bad, STORAGE_WARN_PERCENT: bad })).toEqual({ limit: 400 * MB, warnAt: 320 * MB });
  });

  it("caps the warning threshold at the limit", () => {
    expect(storageLimits({ STORAGE_LIMIT_MB: "10", STORAGE_WARN_PERCENT: "150" }).warnAt).toBe(10 * MB);
  });
});
