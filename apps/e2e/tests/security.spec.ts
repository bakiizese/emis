import { URLS } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';

/** What the browser itself does with the Content-Security-Policy, which unit tests can't show. */
for (const [name, url] of [
  ['the website', URLS.web],
  ['the portal sign-in page', `${URLS.portal}/login`],
] as const) {
  test.describe(name, () => {
    test('sends a policy with a new nonce every time', async ({ session }) => {
      const { page } = await session();
      const nonces = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const response = await page.goto(url);
        const csp = response?.headers()['content-security-policy'] ?? '';
        expect(csp).toContain("frame-ancestors 'none'");
        const scripts = csp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
        expect(scripts).not.toContain('unsafe-inline');
        expect(scripts).not.toContain('unsafe-eval');
        nonces.add(/'nonce-([^']+)'/.exec(csp)?.[1] ?? '');
      }
      expect(nonces.size).toBe(3);
      expect(nonces.has('')).toBe(false);
    });

    test('refuses markup an attacker manages to inject that would run script', async ({
      session,
    }) => {
      const { page, problems, forgetProblems } = await session();
      await page.goto(url);
      await page.waitForLoadState('networkidle');

      // What a stored-XSS bug would let through: HTML with an event handler and a javascript: link.
      // (A script another script creates on purpose is allowed by the policy's 'strict-dynamic';
      // it is injected *markup* that must never run, and here it does not.)
      await page.evaluate(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<img src="data:," onerror="window.__injected=\'handler\'">' +
            '<a id="evil" href="javascript:window.__injected=\'link\'">x</a>',
        );
        document.getElementById('evil')?.click();
      });
      await expect.poll(() => problems.length).toBeGreaterThanOrEqual(2);

      expect(problems.every((p) => p.startsWith('CSP:'))).toBe(true);
      expect(
        await page.evaluate(() => (window as { __injected?: string }).__injected),
      ).toBeUndefined();
      forgetProblems();
    });

    test('cannot be put in a frame on another site', async ({ session }) => {
      const { page, forgetProblems } = await session();
      await page.goto('about:blank');
      await page.evaluate((target) => {
        const frame = document.createElement('iframe');
        frame.src = target;
        document.body.appendChild(frame);
      }, url);

      // A frame the browser refuses to show ends up on its own error page instead of our site.
      await expect
        .poll(() => page.frames().some((f) => f.url().startsWith('chrome-error://')))
        .toBe(true);
      expect(page.frames().some((f) => f.url().startsWith(new URL(url).origin))).toBe(false);
      forgetProblems();
    });
  });
}
