/**
 * Security headers for the two Next.js apps, built in one place so they can't drift apart.
 * A fresh nonce per request lets the framework's own scripts run and nothing else: an injected
 * `<script>` has no nonce and the browser refuses it.
 */

/** 128 random bits, base64. Must be new for every response. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface CspOptions {
  nonce: string;
  /** Development needs eval (React's debugging) and websockets (hot reload); production allows neither. */
  dev: boolean;
}

export function buildCsp({ nonce, dev }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Style *elements* need the nonce too. Style *attributes* (a bar's width, the brand colour)
    // can't run code, so they are allowed.
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ];
  if (!dev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Everything a page response should carry besides the CSP itself. */
export function securityHeaders({ dev }: { dev: boolean }): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Older browsers that don't know frame-ancestors.
    'X-Frame-Options': 'DENY',
    ...(dev ? {} : { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
  };
}

/**
 * Which header carries the policy. Report-only shows what *would* be blocked (in the browser console)
 * without blocking anything: a safety valve while diagnosing a page that misbehaves under the policy.
 */
export const cspHeaderName = (reportOnly: boolean): string =>
  reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
