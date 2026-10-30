export type Host = "APP" | "RENDER";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// __Host- cookies require Secure, which plain-http local dev cannot set
// (design.md 9.2).
export function sessionCookieName(host: Host, devMode: boolean): string {
  const base = host === "APP" ? "rb_app" : "rb_render";
  return devMode ? base : `__Host-${base}`;
}

export function sessionCookieOptions(devMode: boolean) {
  return {
    httpOnly: true,
    secure: !devMode,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
