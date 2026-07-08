import { defineConfig } from 'vitest/config';

// DB-free unit tests for packages/db (currently just src/test-env.test.ts).
// Deliberately SEPARATE from vitest.config.ts: that config calls
// remapDatabaseUrlToTestDb() at load time (the integration path), which both
// demands TEST_DATABASE_URL and mutates process.env — hostile to a pure
// env-string unit test. This config loads no .env, runs no remap, and wires no
// globalSetup, so it never touches a database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
