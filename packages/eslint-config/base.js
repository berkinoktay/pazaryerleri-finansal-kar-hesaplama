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

export const SPREADSHEET_TESTING_MESSAGE =
  'Test-only: it patches in-process, without the parse worker.';

// The shared ban's import paths and patterns. Exported because flat config replaces
// rule options instead of merging them: packages/spreadsheet/eslint.config.mjs restates
// the rule for its own src/** and spreads these, so a pattern added here reaches it too.
export const SPREADSHEET_TESTING_PATHS = [
  { name: '@pazarsync/spreadsheet/testing', message: SPREADSHEET_TESTING_MESSAGE },
];
export const SPREADSHEET_TESTING_PATTERNS = [
  '@pazarsync/spreadsheet/testing',
  '@pazarsync/spreadsheet/testing/**',
  '**/spreadsheet/src/testing',
  '**/spreadsheet/src/testing/**',
  '**/testing/patch-fixture*',
];

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
  {
    // The spreadsheet testing entry patches in-process, without the parse worker
    // and its queue. Production code must never reach it.
    //
    // Banned: a static import or re-export of the entry or anything under it, a
    // dynamic import() whose specifier is a string literal naming the entry or the
    // engine's testing folder, and relative paths into that folder from another
    // package. Relative paths from inside the engine ('./testing', '../testing')
    // are banned by packages/spreadsheet/eslint.config.mjs: a '**/testing' glob
    // here would also catch every consumer's own testing folder.
    // Where: src/** and scripts/** of every package that spreads this config. The
    // globs are relative to the consuming package, so a src/testing/** folder of
    // any consumer is covered too (it could re-export the entry).
    // Allowed: *.test.ts files (co-located engine tests import the entry), tests/**
    // (outside these globs), and the engine's own src/testing/**, which
    // packages/spreadsheet/eslint.config.mjs exempts.
    // Known limit: a computed or template-literal dynamic import() specifier cannot
    // be caught by lint.
    files: ['**/src/**', '**/scripts/**'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: SPREADSHEET_TESTING_PATHS,
          patterns: [{ group: SPREADSHEET_TESTING_PATTERNS, message: SPREADSHEET_TESTING_MESSAGE }],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportExpression > Literal.source[value=/spreadsheet\\/(src\\/)?testing|testing\\/patch-fixture/]',
          message: SPREADSHEET_TESTING_MESSAGE,
        },
      ],
    },
  },
];
