import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, loadEnv } from './env.js';

const minimal = { DATABASE_URL: 'postgres://emis_app:pw@localhost:5433/emis' };

describe('loadEnv', () => {
  it('applies safe defaults', () => {
    const env = loadEnv(minimal);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 4000,
      TRUST_PROXY: false,
      CORS_ORIGINS: [],
      API_DOCS_ENABLED: true,
    });
  });

  it('turns docs off by default in production', () => {
    expect(loadEnv({ ...minimal, NODE_ENV: 'production' }).API_DOCS_ENABLED).toBe(false);
    expect(
      loadEnv({ ...minimal, NODE_ENV: 'production', API_DOCS_ENABLED: 'true' }).API_DOCS_ENABLED,
    ).toBe(true);
  });

  it('parses comma-separated CORS origins', () => {
    const env = loadEnv({
      ...minimal,
      CORS_ORIGINS: 'https://portal.example.com, https://www.example.com',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://portal.example.com', 'https://www.example.com']);
  });

  it('lists every invalid key without echoing secret values', () => {
    let error: unknown;
    try {
      loadEnv({
        DATABASE_URL: 'mysql://root:hunter2@db/emis',
        API_PORT: 'eighty',
        TRUST_PROXY: 'maybe',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(InvalidEnvironmentError);
    const message = (error as Error).message;
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/API_PORT/);
    expect(message).toMatch(/TRUST_PROXY/);
    expect(message).not.toMatch(/hunter2/);
  });
});
