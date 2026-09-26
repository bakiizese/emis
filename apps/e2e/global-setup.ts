import { writeFileSync } from 'node:fs';

import { URLS } from './src/config.js';
import {
  flushValkey,
  resetDatabase,
  type Seed,
  seed,
  startServices,
  stopServices,
  waitFor,
} from './src/stack.js';

/** Builds a fresh install, seeds it, starts the API, worker, website and portal, and stops them afterwards. */
export default async function globalSetup(): Promise<() => void> {
  await resetDatabase();
  await flushValkey();
  const data: Seed = await seed();
  writeFileSync(new URL('./.seed.json', import.meta.url), JSON.stringify(data));

  const services = startServices();
  try {
    await Promise.all([
      waitFor(`${URLS.api}/api/v1/health/ready`, 'api'),
      waitFor(`${URLS.web}/`, 'web'),
      waitFor(`${URLS.portal}/login`, 'portal'),
    ]);
  } catch (error) {
    stopServices(services);
    throw error;
  }
  return () => stopServices(services);
}
