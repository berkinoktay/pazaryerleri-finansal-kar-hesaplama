import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SWATCH_PALETTE } from '@/lib/margin-coloring';
import { ColorSwatchPicker } from '@/components/patterns/color-swatch-picker';

import { render, screen } from '../helpers/render';

describe('<ColorSwatchPicker>', () => {
  const FIRST_COLOR = SWATCH_PALETTE[0]!;
  const SECOND_COLOR = SWATCH_PALETTE[1]!;

  describe('trigger', () => {
    it('renders a button trigger with aria-label', () => {
      render(<ColorSwatchPicker value={FIRST_COLOR} onChange={() => {}} />);
      expect(screen.getByRole('button', { name: 'Renk sec' })).toBeInTheDocument();
    });

    it('uses custom label prop as aria-label', () => {
      render(<ColorSwatchPicker value={FIRST_COLOR} onChange={() => {}} label="Kova rengi" />);
      expect(screen.getByRole('button', { name: 'Kova rengi' })).toBeInTheDocument();
    });

    it('popover is closed initially (palette not visible)', () => {
      render(<ColorSwatchPicker value={FIRST_COLOR} onChange={() => {}} />);
      // Palette buttons are not in the document until the popover opens.
      const paletteButtons = screen.queryAllByRole('button', { name: /oklch/ });
      expect(paletteButtons.length).toBe(0);
    });
  });

  describe('opening the popover', () => {
    it('shows the palette grid when the trigger is clicked', async () => {
      const { user } = render(<ColorSwatchPicker value={FIRST_COLOR} onChange={() => {}} />);
      await user.click(screen.getByRole('button', { name: 'Renk sec' }));
      // Palette swatch buttons appear.
      const paletteButtons = screen.getAllByRole('button', { name: /oklch/ });
      expect(paletteButtons.length).toBeGreaterThanOrEqual(SWATCH_PALETTE.length);
    });
  });

  describe('selecting a color', () => {
    it('calls onChange with the selected color', async () => {
      const onChange = vi.fn();
      const { user } = render(<ColorSwatchPicker value={FIRST_COLOR} onChange={onChange} />);
      await user.click(screen.getByRole('button', { name: 'Renk sec' }));
      // Click the second palette swatch.
      const secondBtn = screen.getByRole('button', { name: SECOND_COLOR });
      await user.click(secondBtn);
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith(SECOND_COLOR);
    });

    it('popover closes after a swatch is selected', async () => {
      const { user } = render(<ColorSwatchPicker value={FIRST_COLOR} onChange={() => {}} />);
      await user.click(screen.getByRole('button', { name: 'Renk sec' }));
      const secondBtn = screen.getByRole('button', { name: SECOND_COLOR });
      await user.click(secondBtn);
      // Palette no longer visible.
      expect(screen.queryAllByRole('button', { name: /oklch/ }).length).toBe(0);
    });
  });

  describe('selected swatch marking', () => {
    it('marks the currently selected swatch with aria-pressed', async () => {
      const { user } = render(<ColorSwatchPicker value={FIRST_COLOR} onChange={() => {}} />);
      await user.click(screen.getByRole('button', { name: 'Renk sec' }));
      const selectedBtn = screen.getByRole('button', { name: FIRST_COLOR });
      expect(selectedBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('other swatches are NOT marked as pressed', async () => {
      const { user } = render(<ColorSwatchPicker value={FIRST_COLOR} onChange={() => {}} />);
      await user.click(screen.getByRole('button', { name: 'Renk sec' }));
      const otherBtn = screen.getByRole('button', { name: SECOND_COLOR });
      expect(otherBtn).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('accessibility', () => {
    it('each palette swatch has an aria-label equal to the color string', async () => {
      const { user } = render(<ColorSwatchPicker value={FIRST_COLOR} onChange={() => {}} />);
      await user.click(screen.getByRole('button', { name: 'Renk sec' }));
      // Every SWATCH_PALETTE entry should have a matching button.
      for (const color of SWATCH_PALETTE) {
        expect(screen.getByRole('button', { name: color })).toBeInTheDocument();
      }
    });
  });
});
