import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Environments (--env) give Workers, D1 and the deploy config their own names,
// so a second deployment cannot overwrite the first. remote.ts reads argv at
// import, so each case runs in a child process.
const ROOT = new URL("../../", import.meta.url).pathname;
const probe = (args: string[], env: Record<string, string> = {}) =>
  JSON.parse(
    execFileSync("pnpm", ["exec", "tsx", "scripts/test/env-probe.ts", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RB_ENV: "", ...env },
    }).trim(),
  );

describe("deploy environments", () => {
  it("defaults to the plain render-box names", () => {
    expect(probe([])).toEqual({
      env: null,
      config: "render-box.deploy.json",
      workers: { render: "render-box-render", admin: "render-box-admin", api: "render-box-api" },
      db: "render-box",
      name: '"render-box-admin"',
      dbName: '"render-box"',
      dbId: '"db-id"',
    });
  });

  it("--env prefixes every name and picks its own config file", () => {
    expect(probe(["--env", "staging"])).toMatchObject({
      env: "staging",
      config: "render-box.staging.deploy.json",
      workers: { render: "render-box-staging-render", admin: "render-box-staging-admin", api: "render-box-staging-api" },
      db: "render-box-staging",
      name: '"render-box-staging-admin"',
      dbName: '"render-box-staging"',
    });
  });

  it("RB_ENV works like --env", () => {
    expect(probe([], { RB_ENV: "qa" })).toMatchObject({ env: "qa", db: "render-box-qa" });
  });

  it("rejects names that cannot be part of a Worker name", () => {
    expect(() => probe(["--env", "Staging_1"])).toThrow();
  });

  it("per-environment configs are not committed", () => {
    expect(readFileSync(new URL(".gitignore", `file://${ROOT}`), "utf8")).toMatch(/^render-box\.\*\.deploy\.json$/m);
  });
});
