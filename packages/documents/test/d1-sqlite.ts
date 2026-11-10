// A minimal D1Database over Node's built-in SQLite, for testing the SQL in
// this package without wrangler. Covers what the code uses: prepare/bind,
// first/all/run, and batch as one transaction. Foreign keys are on, as in D1.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = new URL("../../db/migrations/", import.meta.url);

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params);
  }

  // node:sqlite's all() also executes statements that return no rows.
  private exec(): Record<string, unknown>[] {
    return this.db.prepare(this.sql).all(...(this.params as never[])) as Record<string, unknown>[];
  }

  async all() {
    return { results: this.exec(), success: true, meta: {} };
  }

  async run() {
    return { results: this.exec(), success: true, meta: {} };
  }

  async first(column?: string) {
    const row = this.exec()[0] ?? null;
    if (row === null) return null;
    return column === undefined ? row : (row[column] ?? null);
  }

  // Used by batch: run synchronously inside the transaction.
  runSync() {
    return { results: this.exec(), success: true, meta: {} };
  }
}

export type TestD1 = D1Database & { sqlite: DatabaseSync };

export function createTestD1(opts: { migrations?: string[] } = {}): TestD1 {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of opts.migrations ?? migrationNames()) applyMigration(db, name);

  const d1 = {
    sqlite: db,
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.runSync());
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
  return d1 as unknown as TestD1;
}

export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function applyMigration(db: DatabaseSync, name: string) {
  db.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"));
}

// A body delivered in small pieces and without a declared size, like a
// chunked HTTP request.
export function streamOf(text: string, pieceSize = 64): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + pieceSize));
      offset += pieceSize;
    },
  });
}

export const count = (d1: TestD1, table: string) =>
  (d1.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
