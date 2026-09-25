import { defineConfig } from 'drizzle-kit';

// Migrations are generated from the schema and run as the migrator role (DDL owner).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_MIGRATOR_URL ?? '',
  },
});
