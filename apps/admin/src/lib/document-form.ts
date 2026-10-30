import type { DocumentLink } from "@render-box/db";

export const LIMITS = {
  title: 200,
  description: 2000,
  linkLabel: 100,
  linkUrl: 1000,
  links: 10,
} as const;

export type LinkRow = { label: string; url: string; error?: string };

export type DocumentFormValues = {
  title: string;
  description: string;
  links: LinkRow[];
  uploadId: number | null;
  version: number | null;
};

export type DocumentFormErrors = {
  title?: string;
  description?: string;
  links?: string;
  html?: string;
};

type Body = Record<string, string | File | (string | File)[]>;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asArray = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => (typeof x === "string" ? x : ""));

function parsePositiveInt(v: unknown): number | null {
  const s = asString(v);
  return /^[1-9][0-9]{0,15}$/.test(s) ? Number(s) : null;
}

export function readDocumentForm(body: Body): DocumentFormValues {
  const labels = asArray(body["link_label"]);
  const urls = asArray(body["link_url"]);
  const links: LinkRow[] = [];
  for (let i = 0; i < Math.max(labels.length, urls.length); i++) {
    links.push({ label: (labels[i] ?? "").trim(), url: (urls[i] ?? "").trim() });
  }
  return {
    title: asString(body["title"]).trim(),
    description: asString(body["description"]).replace(/\r\n/g, "\n").trim(),
    links,
    uploadId: parsePositiveInt(body["upload_id"]),
    version: parsePositiveInt(body["version"]),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Returns the cleaned link list (empty rows dropped) plus any errors. Row
// errors are attached to `values.links` for re-display (design.md 4.5).
export function validateDocumentForm(values: DocumentFormValues): {
  errors: DocumentFormErrors;
  links: DocumentLink[];
} {
  const errors: DocumentFormErrors = {};
  if (!values.title) errors.title = "제목을 입력해 주세요.";
  else if (values.title.length > LIMITS.title) errors.title = "제목은 200자까지 쓸 수 있습니다.";
  if (values.description.length > LIMITS.description) errors.description = "설명은 2,000자까지 쓸 수 있습니다.";

  const links: DocumentLink[] = [];
  for (const row of values.links) {
    if (!row.label && !row.url) continue;
    if (!row.url) row.error = "주소를 입력해 주세요. 이름만 있고 주소가 없습니다.";
    else if (row.url.length > LIMITS.linkUrl || !isHttpUrl(row.url))
      row.error = "http:// 또는 https://로 시작하는 주소만 넣을 수 있습니다.";
    else if (row.label.length > LIMITS.linkLabel) row.error = "링크 이름은 100자까지 쓸 수 있습니다.";
    else links.push({ label: row.label, url: row.url });
  }
  if (values.links.some((r) => r.error)) errors.links = "관련 링크를 확인해 주세요.";
  else if (links.length > LIMITS.links) errors.links = "링크는 10개까지 넣을 수 있습니다.";

  return { errors, links };
}

export function hasErrors(errors: DocumentFormErrors): boolean {
  return Object.values(errors).some(Boolean);
}
