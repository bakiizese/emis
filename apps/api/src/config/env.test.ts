import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, loadEnv } from './env.js';

const minimal = {
  DATABASE_URL: 'postgres://emis_app:pw@localhost:5433/emis',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

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

  it('requires a 32-byte encryption key and never echoes it', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => loadEnv({ ...minimal, ENCRYPTION_KEY: short })).toThrow(
      /ENCRYPTION_KEY: must be 32 bytes/,
    );
    expect(() => loadEnv({ ...minimal, ENCRYPTION_KEY: short })).not.toThrow(
      new RegExp(short.slice(0, 10)),
    );
  });

  it('trusts the frontend origins for state-changing requests', () => {
    const env = loadEnv({
      ...minimal,
      PORTAL_URL: 'https://portal.lingua.et/app',
      WEB_URL: 'https://lingua.et',
      TRUSTED_ORIGINS: 'https://admin.lingua.et',
    });
    expect(env.TRUSTED_ORIGINS).toEqual([
      'https://portal.lingua.et',
      'https://lingua.et',
      'https://admin.lingua.et',
    ]);
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
