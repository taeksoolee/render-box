import { describe, expect, it } from "vitest";
import { signHandoff, verifyHandoff } from "./handoff";

describe("handoff token (design.md 3.4)", () => {
  const payload = { sid: "abc", exp: 2_000, ret: "https://r.test/doc" };

  it("round-trips before expiry", async () => {
    const token = await signHandoff("s", payload);
    expect(await verifyHandoff("s", token, 1_000)).toEqual(payload);
  });

  it("rejects expired, wrong-secret, and altered tokens", async () => {
    const token = await signHandoff("s", payload);
    expect(await verifyHandoff("s", token, 2_000)).toBeNull();
    expect(await verifyHandoff("x", token, 1_000)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = btoa(JSON.stringify({ ...payload, sid: "other" })).replace(/=+$/, "");
    expect(await verifyHandoff("s", `${forged}.${sig}`, 1_000)).toBeNull();
    expect(await verifyHandoff("s", `${body}.${sig}.x`, 1_000)).toBeNull();
    expect(await verifyHandoff("s", "garbage", 1_000)).toBeNull();
  });
});
