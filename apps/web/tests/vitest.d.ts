// Vitest 4 moved the `Assertion` interface from the `vitest` package itself
// to `@vitest/expect`, and `vitest`'s index.d.ts now re-exports the same
// interface (`export { Assertion } from '@vitest/expect'`). That means an
// augmentation targeting `declare module 'vitest'` no longer affects what
// `expect(x)` actually returns — the runtime type lives in @vitest/expect.
// @testing-library/jest-dom@6.9.1 still ships only the legacy `vitest`
// augmentation (its `./vitest` entrypoint), so `toBeInTheDocument` /
// `toHaveAttribute` / ... type-check fails in vitest 4. Runtime matcher
// registration still works because that path runs `expect.extend(...)`.
//
// Mirror the augmentation against the new home so tsc --noEmit passes.
// Remove this file the day @testing-library/jest-dom ships a release that
// targets vitest 4 directly.

/// <reference types="@testing-library/jest-dom" />

import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
declare module '@vitest/expect' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
