import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnimatedNumber } from '@/components/patterns/animated-number';

afterEach(() => vi.unstubAllGlobals());

function stubReducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('AnimatedNumber', () => {
  it('renders the formatted final value (reduced motion → no tween)', async () => {
    stubReducedMotion();
    render(<AnimatedNumber value={1234} format={(n) => `%${n.toFixed(0)}`} />);
    await waitFor(() => expect(screen.getByText('%1234')).toBeInTheDocument());
  });
});
