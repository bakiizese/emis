import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC instead of the default transformer: NestJS DI needs `emitDecoratorMetadata`.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
