import { beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "../../documents/test/d1-sqlite";
import { canEdit, loadAccess } from "../src";

// Memberships and the all-projects admin key (design.md 3.9, D-38), on the
// real migrations.
let d1: TestD1;
const run = (sql: string, ...params: unknown[]) => d1.sqlite.prepare(sql).run(...(params as never[]));
const id = (sql: string, ...params: unknown[]) => Number(d1.sqlite.prepare(sql).get(...(params as never[]))!.id);

let member: number;
let admin: number;
let tamna: number;
let other: number;

beforeEach(() => {
  d1 = createTestD1();
  tamna = id("INSERT INTO projects (slug, name, created_at) VALUES ('tamna', 'Tamna', 0) RETURNING id");
  other = id("INSERT INTO projects (slug, name, created_at) VALUES ('other', '다른', 0) RETURNING id");
  member = id("INSERT INTO access_keys (name, key_hash, key_prefix, created_at) VALUES ('m', 'h1', 'rb_m', 0) RETURNING id");
  admin = id("INSERT INTO access_keys (name, key_hash, key_prefix, is_admin, created_at) VALUES ('a', 'h2', 'rb_a', 1, 0) RETURNING id");
  run("INSERT INTO key_projects (key_id, project_id, role, created_at) VALUES (?, ?, 'VIEWER', 0)", member, tamna);
});

const slugs = (a: Awaited<ReturnType<typeof loadAccess>>) => a.projects.map((p) => `${p.slug}:${p.role}`);

describe("loadAccess", () => {
  it("gives a member only its own projects, with their roles", async () => {
    const access = await loadAccess(d1, member);
    expect(access.admin).toBe(false);
    expect(slugs(access)).toEqual(["tamna:VIEWER"]);
    expect(canEdit(access.projects, tamna)).toBe(false);
    expect(canEdit(access.projects, other)).toBe(false);
  });

  it("gives an admin every project as EDITOR without memberships", async () => {
    const access = await loadAccess(d1, admin);
    expect(access.admin).toBe(true);
    expect(slugs(access).sort()).toEqual(["default:EDITOR", "other:EDITOR", "tamna:EDITOR"]); // default comes from migration 0002
  });

  it("includes projects created later, and turning admin off applies at once", async () => {
    const later = id("INSERT INTO projects (slug, name, created_at) VALUES ('later', '나중', 0) RETURNING id");
    expect(canEdit((await loadAccess(d1, admin)).projects, later)).toBe(true);
    run("UPDATE access_keys SET is_admin = 0 WHERE id = ?", admin);
    expect(await loadAccess(d1, admin)).toEqual({ admin: false, projects: [] });
  });
});
