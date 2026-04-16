import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Hono backend (no React, no Next.js). Standard JS + TypeScript recommended
// rules. The dump-openapi.ts script and tests/ are linted alongside src/.
export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores(["dist/**", "node_modules/**", ".turbo/**"]),
]);
