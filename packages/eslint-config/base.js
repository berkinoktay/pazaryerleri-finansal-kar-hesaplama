import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Shared flat ESLint config for node/TypeScript workspace packages (no React,
// no Next.js). Mirrors the apps/api setup: JS + TypeScript recommended rules.
// Consumed by every package and apps/sync-worker via a one-line eslint.config.mjs
// so the profit engine, crypto, and marketplace adapters are actually linted.
//
// Exported as a plain flat-config array (no `eslint/config` import) so the
// package only needs @eslint/js + typescript-eslint as deps; the consuming
// package supplies `eslint` itself.
export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Honor the repo's `_`-prefix convention for intentionally-unused bindings
    // (e.g. `_exhaustive: never`, an unused generator arg `_opts`).
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
