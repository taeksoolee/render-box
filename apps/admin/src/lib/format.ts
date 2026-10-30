const TZ = "Asia/Seoul";

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parts(ms: number) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

const pad = (n: number) => String(n).padStart(2, "0");

// "오늘 14:05" / "10월 28일" / "2025. 3. 2." (ui.md SCR-02)
export function formatRelativeDate(ms: number, now = Date.now()): string {
  const t = parts(ms);
  const n = parts(now);
  if (t.y === n.y && t.m === n.m && t.d === n.d) return `오늘 ${pad(t.hh)}:${pad(t.mm)}`;
  if (t.y === n.y) return `${t.m}월 ${t.d}일`;
  return `${t.y}. ${t.m}. ${t.d}.`;
}

export function formatFullDate(ms: number): string {
  const t = parts(ms);
  return `${t.y}년 ${t.m}월 ${t.d}일 ${pad(t.hh)}:${pad(t.mm)}`;
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

export function linkDisplayName(link: { label: string; url: string }): string {
  if (link.label) return link.label;
  try {
    return new URL(link.url).hostname;
  } catch {
    return link.url;
  }
}
