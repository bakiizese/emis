import type { TestProject } from 'vitest/node';

import { startTestDatabase } from './test-database.js';

/** Starts one database for the whole integration run and shares its URLs via `inject('database')`. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const db = await startTestDatabase();
  project.provide('database', db.urls);
  return db.stop;
}
