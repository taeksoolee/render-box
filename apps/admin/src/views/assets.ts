// Static file URLs for pages. In production they come from the manifest that
// `build:assets` writes (content-hashed, cached for a year); in local dev and
// when the manifest is missing, the plain paths (revalidated each load), so
// CSS watch mode keeps working.
let manifest: Record<string, string> = {};
let loading: Promise<void> | null = null;

export function asset(file: string): string {
  return manifest[file] ?? `/static/${file}`;
}

// Loads the manifest once per isolate from the Worker's own static assets.
// Never throws: without it pages use the plain paths, which still work.
export function loadManifest(assets: Fetcher | undefined, origin: string): Promise<void> {
  loading ??= (async () => {
    try {
      if (!assets) throw new Error("ASSETS binding missing");
      const res = await assets.fetch(new Request(new URL("/static/manifest.json", origin)));
      if (res.ok) manifest = (await res.json()) as Record<string, string>;
    } catch (err) {
      console.error(JSON.stringify({ event: "asset_manifest_unavailable", error: String(err) }));
    }
  })();
  return loading;
}
