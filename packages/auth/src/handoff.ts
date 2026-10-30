import { base64UrlDecode, base64UrlEncode, hmacSign, hmacVerify } from "@render-box/shared";

export const HANDOFF_TTL_MS = 60_000;

export type HandoffPayload = {
  sid: string; // admin session id hash
  exp: number;
  ret: string; // where the render host sends the browser afterwards
};

// Stateless signed token: issuing it writes nothing, so GET /auth/render stays
// side-effect free (design.md 3.4).
export async function signHandoff(secret: string, payload: HandoffPayload): Promise<string> {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmacSign(secret, body)}`;
}

export async function verifyHandoff(secret: string, token: string, now = Date.now()): Promise<HandoffPayload | null> {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  if (!(await hmacVerify(secret, body, sig))) return null;
  const bytes = base64UrlDecode(body);
  if (!bytes) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as HandoffPayload).sid !== "string" ||
    typeof (payload as HandoffPayload).exp !== "number" ||
    typeof (payload as HandoffPayload).ret !== "string"
  ) {
    return null;
  }
  const p = payload as HandoffPayload;
  return p.exp > now ? p : null;
}
