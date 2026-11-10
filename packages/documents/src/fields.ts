import type { DocumentLink } from "@render-box/db";

export const LIMITS = {
  title: 200,
  description: 2000,
  linkLabel: 100,
  linkUrl: 1000,
  links: 10,
} as const;

export type LinkRow = { label: string; url: string; error?: string };

export type DocumentFields = {
  title: string;
  description: string;
  links: LinkRow[];
};

export type DocumentErrors = {
  title?: string;
  description?: string;
  links?: string;
  html?: string;
};

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// A scheme typed with nothing after it counts as an empty address.
const isBlankUrl = (url: string) => url === "" || /^https?:\/\/$/i.test(url);

// Returns the cleaned link list plus any errors. Links are optional, so a row
// without an address (empty, name only, or just "https://") is dropped rather
// than rejected. Row errors are attached to `fields.links` for re-display
// (design.md 4.5).
export function validateDocumentFields(fields: DocumentFields): {
  errors: DocumentErrors;
  links: DocumentLink[];
} {
  const errors: DocumentErrors = {};
  if (!fields.title) errors.title = "제목을 입력해 주세요.";
  else if (fields.title.length > LIMITS.title) errors.title = "제목은 200자까지 쓸 수 있습니다.";
  if (fields.description.length > LIMITS.description) errors.description = "설명은 2,000자까지 쓸 수 있습니다.";

  const links: DocumentLink[] = [];
  for (const row of fields.links) {
    if (isBlankUrl(row.url)) continue;
    if (row.url.length > LIMITS.linkUrl || !isHttpUrl(row.url))
      row.error = "http:// 또는 https://로 시작하는 주소만 넣을 수 있습니다.";
    else if (row.label.length > LIMITS.linkLabel) row.error = "링크 이름은 100자까지 쓸 수 있습니다.";
    else links.push({ label: row.label, url: row.url });
  }
  if (fields.links.some((r) => r.error)) errors.links = "관련 링크를 확인해 주세요.";
  else if (links.length > LIMITS.links) errors.links = "링크는 10개까지 넣을 수 있습니다.";

  return { errors, links };
}

export function hasErrors(errors: DocumentErrors): boolean {
  return Object.values(errors).some(Boolean);
}
