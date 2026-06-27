import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ColorSwatchPicker } from '@/components/patterns/color-swatch-picker';
import { SWATCH_PALETTE } from '@/lib/margin-coloring';

import { render, screen } from '../helpers/render';

const FIRST = SWATCH_PALETTE[0]!;
const SECOND = SWATCH_PALETTE[1]!;

function renderPicker(
  props: Partial<React.ComponentProps<typeof ColorSwatchPicker>> = {},
): ReturnType<typeof render> {
  return render(
    <ColorSwatchPicker
      value={FIRST}
      onChange={() => {}}
      label="Renk sec"
      customLabel="Ozel renk"
      {...props}
    />,
  );
}

describe('<ColorSwatchPicker>', () => {
  it('renders a trigger using the label as aria-label', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: 'Renk sec' })).toBeInTheDocument();
  });

  it('honors a custom label', () => {
    renderPicker({ label: 'Kova rengi' });
    expect(screen.getByRole('button', { name: 'Kova rengi' })).toBeInTheDocument();
  });

  it('keeps the palette hidden until the trigger is clicked', () => {
    renderPicker();
    expect(screen.queryAllByRole('button', { name: /oklch/ })).toHaveLength(0);
  });

  it('opens the palette grid on trigger click', async () => {
    const { user } = renderPicker();
    await user.click(screen.getByRole('button', { name: 'Renk sec' }));
    expect(screen.getAllByRole('button', { name: /oklch/ }).length).toBeGreaterThanOrEqual(
      SWATCH_PALETTE.length,
    );
  });

  it('calls onChange with the selected swatch and closes', async () => {
    const onChange = vi.fn();
    const { user } = renderPicker({ onChange });
    await user.click(screen.getByRole('button', { name: 'Renk sec' }));
    await user.click(screen.getByRole('button', { name: SECOND }));
    expect(onChange).toHaveBeenCalledWith(SECOND);
    expect(screen.queryAllByRole('button', { name: /oklch/ })).toHaveLength(0);
  });

  it('marks the selected swatch with aria-pressed', async () => {
    const { user } = renderPicker();
    await user.click(screen.getByRole('button', { name: 'Renk sec' }));
    expect(screen.getByRole('button', { name: FIRST })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: SECOND })).toHaveAttribute('aria-pressed', 'false');
  });

  it('exposes a custom-color text field in the popover', async () => {
    const { user } = renderPicker();
    await user.click(screen.getByRole('button', { name: 'Renk sec' }));
    expect(screen.getByRole('textbox', { name: 'Ozel renk' })).toBeInTheDocument();
  });
});
