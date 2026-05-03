import Decimal from 'decimal.js';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PercentageInput } from '@/components/patterns/percentage-input';

import { render, screen } from '../helpers/render';

describe('<PercentageInput>', () => {
  it('renders the % symbol as a leading slot by default', () => {
    render(<PercentageInput defaultValue={new Decimal('23.64')} />);
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('honours a custom symbol', () => {
    render(<PercentageInput defaultValue={new Decimal('5')} symbol="‰" />);
    expect(screen.getByText('‰')).toBeInTheDocument();
  });

  it('renders the formatted display string for a Decimal default value', () => {
    const { container } = render(<PercentageInput defaultValue={new Decimal('23.64')} />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('23,64');
  });

  it('emits a parsed Decimal via onChange when the user types tr-TR input', async () => {
    const onChange = vi.fn();
    const { user, container } = render(<PercentageInput onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    await user.type(input, '23,64');
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Decimal | null;
    expect(lastCall?.toString()).toBe('23.64');
  });

  it('allows negative values by default (margin / discount can go negative)', async () => {
    const onChange = vi.fn();
    const { user, container } = render(<PercentageInput onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    await user.type(input, '-5,5');
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Decimal | null;
    expect(lastCall?.isNegative()).toBe(true);
    expect(lastCall?.toString()).toBe('-5.5');
  });

  it('flips negative to positive on emit when nonNegative is true', async () => {
    const onChange = vi.fn();
    const { user, container } = render(<PercentageInput nonNegative onChange={onChange} />);
    const input = container.querySelector('input') as HTMLInputElement;
    await user.type(input, '-5,5');
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as Decimal | null;
    expect(lastCall?.isNegative()).toBe(false);
  });
});
