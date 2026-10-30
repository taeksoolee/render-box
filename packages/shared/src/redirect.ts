// Redirect targets are parsed with the URL parser, never compared as strings:
// browsers strip tabs/newlines, so "/\t/evil.com" would become "//evil.com"
// after passing a string check (design.md 3.7).
export function safeRedirectPath(
  value: string | null | undefined,
  baseOrigin: string,
  allowedPrefixes: readonly string[],
): string | null {
  if (!value || /[\x00-\x1f\x7f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, baseOrigin);
  } catch {
    return null;
  }
  if (url.origin !== baseOrigin) return null;
  if (!allowedPrefixes.some((p) => url.pathname === p || url.pathname.startsWith(p.endsWith("/") ? p : `${p}/`))) {
    return null;
  }
  return url.pathname + url.search;
}
