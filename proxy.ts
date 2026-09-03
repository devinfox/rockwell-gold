// Route guard. In Next.js 16 the `middleware` convention is deprecated and
// renamed to `proxy` — see node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/proxy.md. Proxy runs on the Node.js runtime, so the HMAC
// verification in app/lib/session.ts works here unchanged.
//
// This is the first line of defence only: /api/rm re-checks authorization on
// every request, because a matcher change must never be able to silently open
// a route (per the Next.js data-security guidance).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, SESSION_COOKIE, isStaff } from "./app/lib/session-token";

/** Signed-in customers only. */
const ACCOUNT_PREFIXES = ["/vault", "/orders", "/tax-center", "/checkout", "/auth/kyc-status"];

/** Staff roles only. */
const STAFF_PREFIXES = ["/admin"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const claims = verifyToken(request.cookies.get(SESSION_COOKIE)?.value);

  const needsStaff = STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const needsAccount = ACCOUNT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (needsStaff) {
    if (!claims) return redirectToSignIn(request);
    if (!isStaff(claims.role)) {
      return NextResponse.redirect(new URL("/vault", request.url));
    }
    return NextResponse.next();
  }

  if (needsAccount && !claims) {
    return redirectToSignIn(request);
  }

  return NextResponse.next();
}

function redirectToSignIn(request: NextRequest) {
  const url = new URL("/auth/sign-in", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Exclude static assets and image optimisation so the guard can never block CSS/JS.
  matcher: ["/((?!_next/static|_next/image|assets|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js)$).*)"],
};
