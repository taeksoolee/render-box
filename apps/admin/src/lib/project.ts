import type { Membership } from "@render-box/auth";

// The project the list, the new-document form and the storage page work in
// (design.md 3.9): ?project=<slug>, else the last one viewed (cookie), else the
// deployment's DEFAULT_PROJECT if the key is in it, else the first by name.
// Slugs the key is not in are skipped, so none of these can reveal a project.
export function pickProject(
  projects: Membership[],
  opts: { query?: string; cookie?: string; fallback?: string },
): { project: Membership | null; fromQuery: boolean } {
  const bySlug = (slug: string | undefined) => (slug ? projects.find((p) => p.slug === slug) : undefined);
  const chosen = bySlug(opts.query);
  if (chosen) return { project: chosen, fromQuery: true };
  return { project: bySlug(opts.cookie) ?? bySlug(opts.fallback?.trim()) ?? projects[0] ?? null, fromQuery: false };
}
