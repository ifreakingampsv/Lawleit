import type { FastifyRequest } from "fastify";
import type { ApiFirm, ApiUser } from "../services/auth/repository.js";
import { HttpError } from "../services/httpError.js";

/**
 * The authenticated request context attached by the session guard on every
 * protected route: the raw session token plus the session's user and firm.
 */
export interface RequestAuth {
  token: string;
  user: ApiUser;
  firm: ApiFirm;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: RequestAuth;
  }
}

/** Sent on every credential-bearing request; also accepted from the cookie. */
export const SESSION_COOKIE = "lawleit_session";

/**
 * Bearer-or-cookie token extraction, mirroring the reference backend and the
 * REST adapter (which sends both forms on every request). The token is
 * base64url, so no cookie decoding is needed.
 */
export function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (bearer) return bearer;
  const pattern = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`);
  return pattern.exec(request.headers.cookie ?? "")?.[1] ?? null;
}

/** Shown (as a 503 envelope) when the API runs without a database. */
export const DB_REQUIRED =
  "Database not configured — set DATABASE_URL to enable auth (see backend/.env.example)";

/** The session guard has run; a missing context means the guard was bypassed. */
export function requireAuth(request: FastifyRequest): RequestAuth {
  if (!request.auth) throw new HttpError(401, "Not signed in");
  return request.auth;
}
