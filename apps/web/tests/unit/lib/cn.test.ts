import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

describe('cn', () => {
  it('lets a later semantic spacing class override an earlier one of the same group', () => {
    expect(cn('px-sm', 'p-0')).toBe('p-0');
    expect(cn('gap-3xs', 'gap-md')).toBe('gap-md');
  });

  it('lets a consumer animation class override the field shake under the same variant', () => {
    expect(cn('data-[invalid=true]:animate-field-shake', 'data-[invalid=true]:animate-none')).toBe(
      'data-[invalid=true]:animate-none',
    );
    expect(cn('aria-invalid:animate-field-shake', 'aria-invalid:animate-none')).toBe(
      'aria-invalid:animate-none',
    );
  });

  it('lets the wide detail sheet width replace the base sheet widths at every breakpoint', () => {
    // The Sheet primitive's right-side base widths, then the order detail sheet's override.
    expect(cn('max-w-sheet sm:max-w-sheet-wide', 'max-w-sheet-detail sm:max-w-sheet-detail')).toBe(
      'max-w-sheet-detail sm:max-w-sheet-detail',
    );
  });

  it('keeps an animation timing class beside the animation it times', () => {
    expect(cn('animate-field-shake', 'animate-duration-fast')).toBe(
      'animate-field-shake animate-duration-fast',
    );
  });
});
