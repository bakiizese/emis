import { buildCsp, cspHeaderName, generateNonce, securityHeaders } from '@emis/ui/lib/csp';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Where /api goes when nothing in front of the site (Caddy in production) already routes it to the
 * API. Read at request time, so the same build works wherever it is deployed.
 */
const apiTarget = (request: NextRequest): URL =>
  new URL(
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
    process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
  );

/** Gives every page a fresh nonce-based Content-Security-Policy and the standard security headers. */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.rewrite(apiTarget(request));

  const dev = process.env.NODE_ENV === 'development';
  const csp = buildCsp({ nonce: generateNonce(), dev });
  // CSP_REPORT_ONLY=true reports violations in the browser console instead of blocking them.
  const cspHeader = cspHeaderName(process.env.CSP_REPORT_ONLY === 'true');

  const requestHeaders = new Headers(request.headers);
  // Next.js reads the nonce from this header while rendering and stamps it on its scripts.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(cspHeader, csp);
  for (const [name, value] of Object.entries(securityHeaders({ dev }))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Pages and the /api proxy: not static files, and prefetches don't need a policy.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
