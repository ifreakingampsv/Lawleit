import { SESSION_COOKIE } from "./requestAuth.js";
import { SESSION_TTL_SECONDS } from "../services/auth/service.js";

/**
 * Cookie attribute values for SameSite. Browsers expect canonical casing
 ("Lax"/"None"); config uses the lowercase forms (COOKIE_SAMESITE=lax|none).
 */
const SAMESITE_VALUE = { lax: "Lax", none: "None" } as const;

export interface CookieAttrs {
  sameSite: "lax" | "none";
  secure: boolean;
}

/**
 * Attributes exactly as the reference backend sets them (HttpOnly, Path=/,
 * SameSite=Lax, one-week Max-Age) with SameSite/Secure configurable so the
 * production cross-site deploy (ticket 19) can set none+secure.
 */
export function sessionCookie(token: string, attrs: CookieAttrs): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    `SameSite=${SAMESITE_VALUE[attrs.sameSite]}`,
    ...(attrs.secure ? ["Secure"] : []),
  ].join("; ");
}

/** Mirror of sessionCookie() with Max-Age=0 — the logout clear. */
export function clearSessionCookie(attrs: CookieAttrs): string {
  return [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "Max-Age=0",
    `SameSite=${SAMESITE_VALUE[attrs.sameSite]}`,
    ...(attrs.secure ? ["Secure"] : []),
  ].join("; ");
}
