// Total HTML storage and its cap (design.md 4.9). Uploads past the cap are
// rejected; nothing is pruned automatically.

const MB = 1024 * 1024;

export type StorageConfig = { STORAGE_LIMIT_MB?: string; STORAGE_WARN_PERCENT?: string };

export type StorageLimits = { limit: number; warnAt: number };

export type StorageUsage = StorageLimits & {
  used: number;
  // Blobs kept only by previous versions; deleting versions frees this.
  previous: number;
};

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function storageLimits(env: StorageConfig): StorageLimits {
  const limit = Math.round(positive(env.STORAGE_LIMIT_MB, 400) * MB);
  const percent = Math.min(100, positive(env.STORAGE_WARN_PERCENT, 80));
  return { limit, warnAt: Math.round((limit * percent) / 100) };
}

// Counts every blob once, whether it is a current version, a previous one,
// shared by several versions, or an upload not yet attached.
export async function usedBytes(d1: D1Database): Promise<number> {
  const row = await d1.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM html_blobs").first<{ used: number }>();
  return row?.used ?? 0;
}

export async function storageUsage(d1: D1Database, limits: StorageLimits): Promise<StorageUsage> {
  const row = await d1
    .prepare(
      `SELECT COALESCE(SUM(b.size), 0) AS used,
              COALESCE(SUM(CASE
                WHEN NOT EXISTS (SELECT 1 FROM html_documents d WHERE d.blob_id = b.id)
                 AND EXISTS (SELECT 1 FROM html_document_versions v WHERE v.blob_id = b.id)
                THEN b.size END), 0) AS previous
       FROM html_blobs b`,
    )
    .first<{ used: number; previous: number }>();
  return { ...limits, used: row?.used ?? 0, previous: row?.previous ?? 0 };
}

export const STORAGE_FULL_MESSAGE = "저장 공간이 부족합니다. 이전 버전이나 안 쓰는 문서를 지워 주세요.";
