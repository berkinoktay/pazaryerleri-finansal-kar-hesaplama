import { describe, expect, it } from 'vitest';

import { SignedAmount } from '@/components/patterns/signed-amount';

import { render } from '../../helpers/render';

/**
 * SignedAmount derives the glyph from the served string, never from
 * arithmetic. A deduction row shows "−", a positive-direction row "+", a
 * negative served value flips the glyph, and a zero amount shows no glyph at
 * all (a clamped Net KDV of 0.00 must not read as "−₺0,00").
 */
describe('SignedAmount', () => {
  it('prefixes a deduction row with a minus', () => {
    const { container } = render(<SignedAmount value="28.00" positive={false} />);
    expect(container.textContent?.startsWith('−')).toBe(true);
    expect(container.textContent).toContain('28,00');
  });

  it('prefixes a positive-direction row with a plus', () => {
    const { container } = render(<SignedAmount value="12.73" positive />);
    expect(container.textContent?.startsWith('+')).toBe(true);
  });

  it('flips the glyph when the served value is negative', () => {
    const { container } = render(<SignedAmount value="-26.32" positive={false} />);
    expect(container.textContent?.startsWith('+')).toBe(true);
    expect(container.textContent).toContain('26,32');
    expect(container.textContent).not.toContain('-');
  });

  it.each(['0', '0.00', '-0.00'])('shows no glyph for the zero amount %s', (value) => {
    const { container } = render(<SignedAmount value={value} positive={false} />);
    const text = container.textContent ?? '';
    expect(text.startsWith('−')).toBe(false);
    expect(text.startsWith('+')).toBe(false);
    expect(text).toContain('0,00');
  });
});
