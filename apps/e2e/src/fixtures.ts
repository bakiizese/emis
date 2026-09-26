import { readFileSync } from 'node:fs';

import { type BrowserContext, type Page, test as base } from '@playwright/test';

import type { Seed } from './stack.js';

export const seedData = (): Seed =>
  JSON.parse(readFileSync(new URL('../.seed.json', import.meta.url), 'utf8')) as Seed;

export interface Session {
  context: BrowserContext;
  page: Page;
  /** What the browser has complained about so far in any session of this test. */
  problems: string[];
  /** Forget them: for a test that provokes a complaint on purpose and has checked it. */
  forgetProblems: () => void;
}

/**
 * Every browser session the tests open is watched for two things that would mean a real user is
 * hurting: a script or style the Content-Security-Policy refused, and an uncaught JavaScript error.
 * The test fails afterwards if either happened anywhere.
 */
export const test = base.extend<{
  session: (cookie?: { name: string; value: string }) => Promise<Session>;
}>({
  session: async ({ browser }, use) => {
    const problems: string[] = [];
    const contexts: BrowserContext[] = [];

    const watch = (page: Page) => {
      page.on('console', (message) => {
        const text = message.text();
        if (/content security policy|refused to (load|execute|apply)/i.test(text)) {
          problems.push(`CSP: ${text} (${page.url()})`);
        }
      });
      page.on('pageerror', (error) =>
        problems.push(`Uncaught error: ${error.message} (${page.url()})`),
      );
    };

    await use(async (cookie) => {
      const context = await browser.newContext({
        locale: 'en-US',
        timezoneId: 'Africa/Addis_Ababa',
      });
      contexts.push(context);
      context.on('page', watch);
      if (cookie)
        await context.addCookies([
          // A __Host- cookie: host-only, secure, path /, exactly as the API sets it.
          {
            ...cookie,
            domain: 'localhost',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]);
      return {
        context,
        page: await context.newPage(),
        problems,
        forgetProblems: () => void problems.splice(0),
      };
    });

    await Promise.all(contexts.map((c) => c.close()));
    if (problems.length > 0)
      throw new Error(`The browser reported problems:\n${problems.join('\n')}`);
  },
});

export { expect } from '@playwright/test';
