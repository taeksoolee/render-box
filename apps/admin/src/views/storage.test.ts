import { describe, expect, it } from "vitest";
import { StorageSummary, storageLevel } from "./storage";

// List-page banners by usage level (design.md 4.9).
const MB = 1024 * 1024;
const usage = (usedMb: number) => ({ limit: 400 * MB, warnAt: 320 * MB, used: usedMb * MB, previous: 5 * MB });
const render = (usedMb: number) => String(StorageSummary({ usage: usage(usedMb) }));

describe("storage summary", () => {
  it.each([
    [0, "ok"],
    [319, "ok"],
    [320, "warn"],
    [399, "warn"],
    [400, "full"],
    [450, "full"],
  ] as const)("%d MB of 400 is %s", (used, level) => {
    expect(storageLevel(usage(used))).toBe(level);
  });

  it("shows only the meter below the warning threshold", () => {
    const html = render(100);
    expect(html).toContain("100.0 MB / 400.0 MB · 이전 버전 5.0 MB");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("얼마 남지 않았습니다");
  });

  it("warns past the threshold and links to the storage screen", () => {
    const html = render(330);
    expect(html).toContain("저장 공간이 얼마 남지 않았습니다");
    expect(html).toContain('href="/storage"');
  });

  it("says uploads are blocked when full", () => {
    const html = render(400);
    expect(html).toContain("저장 공간이 가득 찼습니다");
    expect(html).toContain('role="alert"');
  });

  it("never draws the meter past 100%", () => {
    expect(render(800)).toContain('width="100.0%"');
  });
});
