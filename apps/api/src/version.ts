import { readFileSync } from 'node:fs';

/** Version from apps/api/package.json, resolved the same way from src/ and dist/. */
export const API_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
