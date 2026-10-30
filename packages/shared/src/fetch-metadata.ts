import type { MiddlewareHandler } from "hono";

export type FetchMetadataOptions = {
  // Paths that skip the check entirely (e.g. health checks, assets loaded by
  // sandboxed documents).
  skip?: (path: string) => boolean;
};

// Rejects requests initiated by other sites or by sandboxed (opaque origin)
// documents, independent of whether cookies were attached (design.md 3.6).
export function isAllowedByFetchMetadata(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === null) return true;
  if (site === "same-origin" || site === "none") return true;
  return (
    req.method === "GET" &&
    req.headers.get("sec-fetch-mode") === "navigate" &&
    req.headers.get("sec-fetch-dest") === "document"
  );
}

export function fetchMetadataGuard(options: FetchMetadataOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    if (options.skip?.(c.req.path) || isAllowedByFetchMetadata(c.req.raw)) {
      await next();
      return;
    }
    console.log(
      JSON.stringify({ event: "fetch_metadata_blocked", path: c.req.path, site: c.req.header("sec-fetch-site") }),
    );
    return c.text("Forbidden", 403);
  };
}
