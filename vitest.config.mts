import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// fileURLToPath (not URL.pathname) - on Windows the latter yields "/C:/..." which
// is not a valid filesystem path.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Loaded at config time, before any test module is imported. An `import
// 'dotenv/config'` inside a test file runs too late: ES import hoisting means the
// database module is evaluated first and sees an empty DATABASE_URL.
loadDotenv({ path: path.join(rootDir, '.env'), quiet: true });

export default defineConfig({
  resolve: { alias: { '@': path.resolve(rootDir, './src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests share one local database; running files in parallel
    // would let them clobber each other's rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
