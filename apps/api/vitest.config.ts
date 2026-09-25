import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC instead of the default transformer: NestJS DI needs `emitDecoratorMetadata`.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        // Real PostgreSQL via Testcontainers, set up by the shared @emis/db global setup.
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          globalSetup: ['@emis/db/testing/vitest-global-setup'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
