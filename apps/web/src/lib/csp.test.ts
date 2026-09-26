import { buildCsp, cspHeaderName, generateNonce, securityHeaders } from '@emis/ui/lib/csp';
import { describe, expect, it } from 'vitest';

const directive = (csp: string, name: string) =>
  csp.split('; ').find((d) => d.startsWith(`${name} `) || d === name);

describe('generateNonce', () => {
  it('is 128 bits of base64 and never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, generateNonce));
    expect(seen.size).toBe(200);
    for (const nonce of seen) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('buildCsp in production', () => {
  const csp = buildCsp({ nonce: 'abc123==', dev: false });

  it('lets only nonce-stamped scripts run: no inline, no eval', () => {
    const scripts = directive(csp, 'script-src') ?? '';
    expect(scripts).toContain("'nonce-abc123=='");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
  });

  it('requires the nonce on style elements too, and allows only style attributes inline', () => {
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'nonce-abc123=='");
    expect(directive(csp, 'style-src-attr')).toBe("style-src-attr 'unsafe-inline'");
  });

  it('shuts the doors nothing here uses', () => {
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(csp, 'form-action')).toBe("form-action 'self'");
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
  });

  it('only talks to its own origin and forces https', () => {
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(csp, 'upgrade-insecure-requests')).toBe('upgrade-insecure-requests');
  });

  it('has no wildcard or http: source anywhere', () => {
    expect(csp).not.toMatch(/(\s|^)\*(\s|;|$)|\shttp:|\shttps:\s/);
  });
});

describe('buildCsp in development', () => {
  const csp = buildCsp({ nonce: 'n', dev: true });

  it('allows what hot reload needs and nothing more', () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toContain('ws:');
    expect(directive(csp, 'upgrade-insecure-requests')).toBeUndefined();
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });
});

describe('securityHeaders', () => {
  it('always stops sniffing, framing and leaking referrers', () => {
    for (const dev of [true, false]) {
      const headers = securityHeaders({ dev });
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['Permissions-Policy']).toContain('camera=()');
    }
  });

  it('sends HSTS in production only, since a browser would remember it for localhost', () => {
    expect(securityHeaders({ dev: false })['Strict-Transport-Security']).toContain(
      'max-age=31536000',
    );
    expect(securityHeaders({ dev: true })['Strict-Transport-Security']).toBeUndefined();
  });
});

describe('cspHeaderName', () => {
  it('enforces by default and can be switched to report-only', () => {
    expect(cspHeaderName(false)).toBe('Content-Security-Policy');
    expect(cspHeaderName(true)).toBe('Content-Security-Policy-Report-Only');
  });
});
