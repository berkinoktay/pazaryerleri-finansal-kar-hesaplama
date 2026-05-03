import Decimal from 'decimal.js';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MoneyInput, formatTrMoney, parseTrMoney } from '@/components/patterns/money-input';

import { render, screen } from '../helpers/render';

describe('parseTrMoney (helper)', () => {
  it.each([
    ['1234,50', '1234.5'],
    ['1.234,50', '1234.5'],
    ['1234', '1234'],
    ['-12,5', '-12.5'],
  ])('parses %s to %s', (input, expected) => {
    expect(parseTrMoney(input)?.toString()).toBe(expected);
  });

  it.each(['', '   ', '-', ',', '-,', 'abc'])('returns null for unparseable input %s', (input) => {
    expect(parseTrMoney(input)).toBeNull();
  });
});

describe('formatTrMoney (helper)', () => {
  it('formats a Decimal with the requested scale and tr-TR decimal separator', () => {
    expect(formatTrMoney(new Decimal('1234.5'), 2)).toBe('1234,5');
    expect(formatTrMoney(new Decimal('1234'), 0)).toBe('1234');
  });
});

describe('<MoneyInput>', () => {
  it('renders the ₺ symbol as a leading slot by default', () => {
    render(<MoneyInput defaultValue={new Decimal('100')} />);
    expect(screen.getByText('₺')).toBeInTheDocument();
  });

  it('honours a custom symbol', () => {
    render(<MoneyInput defaultValue={new Decimal('100')} symbol="$" />);
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('renders the formatted display string for a Decimal default value', () => {
    const { container } = render(<MoneyInput defaultValue={new Decimal('1234.50')} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('1234,5');
  });

  it('renders an empty string when defaultValue is null', () => {
    const { container } = render(<MoneyInput defaultValue={null} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('emits a parsed Decimal via onChange when the user types tr-TR input', async () => {
    const onChange = vi.fn();
    const { user, container } = render(<MoneyInput onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    await user.type(input, '12,5');
    // Multiple onChange firings during type — assert the last one carries 12.5.
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Decimal | null;
    expect(lastCall?.toString()).toBe('12.5');
  });

  it('emits null via onChange when the input becomes empty / unparseable', async () => {
    const onChange = vi.fn();
    const { user, container } = render(
      <MoneyInput defaultValue={new Decimal('5')} onChange={onChange} />,
    );
    const input = container.querySelector('input') as HTMLInputElement;
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('flips negative input to positive on emit when nonNegative is true', async () => {
    const onChange = vi.fn();
    const { user, container } = render(<MoneyInput nonNegative onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    await user.type(input, '-12,5');
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Decimal | null;
    expect(lastCall?.isNegative()).toBe(false);
    expect(lastCall?.toString()).toBe('12.5');
  });

  it('uses inputMode=decimal for mobile-friendly numeric keypad', () => {
    const { container } = render(<MoneyInput />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });
});
