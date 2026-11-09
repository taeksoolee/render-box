import type { DocumentFields, LinkRow } from "@render-box/documents";

// Field rules are shared with the MCP app; this module only reads the admin form.
export {
  hasErrors,
  LIMITS,
  validateDocumentFields as validateDocumentForm,
  type DocumentErrors as DocumentFormErrors,
  type LinkRow,
} from "@render-box/documents";

export type DocumentFormValues = DocumentFields & {
  uploadId: number | null;
  version: number | null;
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
