// Copies the admin's static files to content-hashed names under
// public/static/h/ and writes public/static/manifest.json, so pages can link
// them with a year-long immutable cache (public/_headers). Runs at the end of
// `build:assets`; stale hashed files are removed.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const STATIC = new URL("../apps/admin/public/static/", import.meta.url);
const OUT = new URL("h/", STATIC);
const FILES = ["app.css", "js/app.js", "js/htmx.min.js", "logo.svg", "apple-touch-icon.png"];

mkdirSync(OUT, { recursive: true });
const manifest: Record<string, string> = {};
for (const file of FILES) {
  const bytes = readFileSync(new URL(file, STATIC));
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const base = file.split("/").pop()!;
  const dot = base.lastIndexOf(".");
  const name = `${base.slice(0, dot)}.${hash}${base.slice(dot)}`;
  copyFileSync(new URL(file, STATIC), new URL(name, OUT));
  manifest[file] = `/static/h/${name}`;
}
const keep = new Set(Object.values(manifest).map((p) => p.split("/").pop()));
for (const f of readdirSync(OUT)) if (!keep.has(f)) rmSync(new URL(f, OUT));
writeFileSync(new URL("manifest.json", STATIC), JSON.stringify(manifest, null, 2) + "\n");
console.log(`fingerprinted ${FILES.length} files`);
