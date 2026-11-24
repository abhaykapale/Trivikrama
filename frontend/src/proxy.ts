import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/login"]);

export function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const csp = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const hasSessionCookie = request.cookies.has("siem_token");
  const isPublic = PUBLIC_PATHS.has(request.nextUrl.pathname);
  let response: NextResponse;

  if (!hasSessionCookie && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") loginUrl.searchParams.set("next", request.nextUrl.pathname);
    response = NextResponse.redirect(loginUrl);
  } else {
    // Cookie presence is only a routing hint. /auth/me performs authentication.
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function buildContentSecurityPolicy(nonce: string): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";
  const websocketUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL ?? "ws://localhost:3000/ws";
  const connectSources = ["'self'", getOrigin(apiUrl), getOrigin(websocketUrl)].filter(Boolean).join(" ");
  const developmentScriptPolicy = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScriptPolicy}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (process.env.NODE_ENV === "production") directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

function getOrigin(value: string): string {
  if (value.startsWith("/")) return "";
  try { return new URL(value).origin; } catch { return ""; }
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|logo.svg|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
