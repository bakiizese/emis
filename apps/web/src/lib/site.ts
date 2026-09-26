/** The public address of the website, for canonical links and the sitemap. */
export const siteUrl = (): string =>
  (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
