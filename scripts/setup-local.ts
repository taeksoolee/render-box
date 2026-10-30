// Writes .dev.vars for both apps with a shared random HANDOFF_SECRET.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const secret = randomBytes(32).toString("base64url");
for (const app of ["admin", "render"]) {
  const target = `apps/${app}/.dev.vars`;
  if (existsSync(target)) {
    console.log(`${target} already exists, skipped`);
    continue;
  }
  const example = readFileSync(`apps/${app}/.dev.vars.example`, "utf8");
  writeFileSync(target, example.replace("replace-with-random-secret", secret));
  console.log(`wrote ${target}`);
}
