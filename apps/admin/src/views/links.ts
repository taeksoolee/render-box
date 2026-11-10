// Outbound links shown in the admin UI. HELP_URL is a per-deployment setting
// (a team may point it at its own guide, or "" to hide it), so it is set once
// per request from env; it never varies between requests of one deployment.
export const SOURCE_URL = "https://github.com/taeksoolee/render-box";
const DEFAULT_HELP_URL = `${SOURCE_URL}/blob/main/docs/guide.md`;

let helpUrl: string | null = DEFAULT_HELP_URL;

export function setHelpUrl(value: string | undefined) {
  helpUrl = value === undefined ? DEFAULT_HELP_URL : value.trim() || null;
}

export const getHelpUrl = () => helpUrl;

// A section of the guide, e.g. "ai-도구로-올리기" for MCP setup.
export const helpSection = (anchor: string) => (helpUrl ? `${helpUrl}#${anchor}` : null);
