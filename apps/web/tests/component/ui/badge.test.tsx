import { describe, expect, it, vi } from 'vitest';

import { Badge } from '@/components/ui/badge';

import { render, screen } from '../../helpers/render';

describe('Badge primitive', () => {
  describe('plain usage', () => {
    it('renders the children as label', () => {
      render(<Badge>Senkron</Badge>);
      expect(screen.getByText('Senkron')).toBeInTheDocument();
    });
  });

  describe('leading / trailing icon slots', () => {
    it('renders leadingIcon before the label', () => {
      render(<Badge leadingIcon={<svg data-testid="lead" aria-hidden="true" />}>Başarılı</Badge>);
      expect(screen.getByTestId('lead')).toBeInTheDocument();
    });

    it('renders trailingIcon after the label', () => {
      render(<Badge trailingIcon={<svg data-testid="trail" aria-hidden="true" />}>Etiket</Badge>);
      expect(screen.getByTestId('trail')).toBeInTheDocument();
    });

    it('hides trailingIcon when onRemove is also provided', () => {
      render(
        <Badge
          trailingIcon={<svg data-testid="trail" aria-hidden="true" />}
          onRemove={vi.fn()}
          removeLabel="Kaldır"
        >
          Filter
        </Badge>,
      );
      expect(screen.queryByTestId('trail')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Kaldır' })).toBeInTheDocument();
    });
  });

  describe('onRemove prop', () => {
    it('renders a button with the translated aria-label', () => {
      render(
        <Badge onRemove={vi.fn()} removeLabel="Kaldır">
          Trendyol
        </Badge>,
      );
      expect(screen.getByRole('button', { name: 'Kaldır' })).toBeInTheDocument();
    });

    it('fires onRemove when the button is clicked', async () => {
      const onRemove = vi.fn();
      const { user } = render(
        <Badge onRemove={onRemove} removeLabel="Kaldır">
          Trendyol
        </Badge>,
      );
      await user.click(screen.getByRole('button', { name: 'Kaldır' }));
      expect(onRemove).toHaveBeenCalledOnce();
    });

    it('does not render the button when onRemove is omitted', () => {
      render(<Badge>Senkron</Badge>);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
