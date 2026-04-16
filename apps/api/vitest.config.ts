import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Integration tests share one Postgres DB and TRUNCATE between tests.
    // Running test files in parallel forks would race: file A's TRUNCATE
    // wipes the data file B just inserted in its beforeEach. Tests within
    // a single file still run in order, so TRUNCATE in beforeEach is safe.
    fileParallelism: false,
  },
});
