import base, {
  SPREADSHEET_TESTING_MESSAGE,
  SPREADSHEET_TESTING_PATHS,
  SPREADSHEET_TESTING_PATTERNS,
} from '@pazarsync/eslint-config';

export default [
  ...base,
  {
    // Inside the engine, production code reaches the test-only entry through a
    // relative path ('./testing', '../testing', './testing/build-xlsx'), which the
    // shared globs in base.js do not name. base.js cannot ban '**/testing' itself:
    // its globs are relative to each consumer and would catch that consumer's own
    // testing folder. Flat config replaces rule options instead of merging them, so
    // this block spreads the shared paths and patterns base.js exports and adds the
    // engine's own testing folder, static and dynamic.
    files: ['src/**'],
    ignores: ['src/testing/**', '**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: SPREADSHEET_TESTING_PATHS,
          patterns: [
            {
              group: [...SPREADSHEET_TESTING_PATTERNS, '**/testing', '**/testing/**'],
              message: SPREADSHEET_TESTING_MESSAGE,
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // Any `testing` path segment; a superset of the base.js selector.
          selector: 'ImportExpression > Literal.source[value=/(^|\\/)testing(\\/|$)/]',
          message: SPREADSHEET_TESTING_MESSAGE,
        },
      ],
    },
  },
  {
    // src/testing/** is the test-only entry itself: it imports its own files, so
    // the shared ban on reaching the entry does not apply here. This block must
    // come after `base` to override it.
    files: ['src/testing/**'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
