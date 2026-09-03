import "server-only";

// Cookie-bound session helpers. Split from session-token.ts because proxy.ts
// must not pull in next/headers — see proxy.md in the bundled Next 16 docs.

import { cookies } from "next/headers";
import { issueToken, verifyToken, SESSION_COOKIE, type SessionClaims } from "./session-token";

export * from "./session-token";

const MAX_AGE_S = 7 * 24 * 3600;

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function readSession(): Promise<SessionClaims | null> {
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value);
}

export async function writeSession(claims: Omit<SessionClaims, "iat" | "exp">) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, issueToken(claims), { ...cookieOptions, maxAge: MAX_AGE_S });
}

export async function clearSession() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}
