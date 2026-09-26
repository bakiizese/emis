import { buildCsp, cspHeaderName, generateNonce, securityHeaders } from '@emis/ui/lib/csp';
import { type NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? '__Host-emis_session';
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/accept-invite'];

/**
 * Two jobs for every page. First, a cheap gate: no session cookie means go and sign in (the API still
 * validates every request; this only avoids rendering staff pages for visitors who are obviously
 * signed out). Second, a fresh nonce-based Content-Security-Policy and the standard security headers.
 */
export function proxy(request: NextRequest) {
  // Where /api goes when nothing in front of the portal (Caddy in production) already routes it to the
  // API. Read at request time, so the same build works wherever it is deployed.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.rewrite(
      new URL(
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
        process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
      ),
    );
  }

  const dev = process.env.NODE_ENV === 'development';
  const csp = buildCsp({ nonce: generateNonce(), dev });
  // CSP_REPORT_ONLY=true reports violations in the browser console instead of blocking them.
  const cspHeader = cspHeaderName(process.env.CSP_REPORT_ONLY === 'true');
  const withHeaders = (response: NextResponse) => {
    response.headers.set(cspHeader, csp);
    for (const [name, value] of Object.entries(securityHeaders({ dev }))) {
      response.headers.set(name, value);
    }
    return response;
  };

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    const login = new URL('/login', request.url);
    if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
    return withHeaders(NextResponse.redirect(login));
  }

  // Next.js reads the nonce from the request's policy while rendering and stamps it on its scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
