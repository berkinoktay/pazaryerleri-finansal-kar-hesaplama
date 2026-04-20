import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';

import { render, screen } from '../../helpers/render';

describe('Button primitive', () => {
  describe('plain usage', () => {
    it('renders children as label', () => {
      render(<Button>Kaydet</Button>);
      expect(screen.getByRole('button', { name: 'Kaydet' })).toBeInTheDocument();
    });

    it('forwards props to the underlying button', () => {
      render(
        <Button type="submit" data-testid="btn">
          Gönder
        </Button>,
      );
      expect(screen.getByTestId('btn')).toHaveAttribute('type', 'submit');
    });
  });

  describe('leading / trailing icon slots', () => {
    it('renders leadingIcon before the label', () => {
      render(<Button leadingIcon={<svg data-testid="lead" aria-hidden="true" />}>Kaydet</Button>);
      expect(screen.getByTestId('lead')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Kaydet/ })).toBeInTheDocument();
    });

    it('renders trailingIcon after the label', () => {
      render(<Button trailingIcon={<svg data-testid="trail" aria-hidden="true" />}>İleri</Button>);
      expect(screen.getByTestId('trail')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('sets aria-busy="true" when loading', () => {
      render(<Button loading>Gönder</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });

    it('disables the button when loading', () => {
      render(<Button loading>Gönder</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('renders the spinner with the translated label', () => {
      render(
        <Button loading loadingLabel="Yükleniyor">
          Gönder
        </Button>,
      );
      expect(screen.getByRole('status', { name: 'Yükleniyor' })).toBeInTheDocument();
    });

    it('replaces children with loadingText when provided', () => {
      render(
        <Button loading loadingText="Gönderiliyor…">
          Gönder
        </Button>,
      );
      expect(screen.getByRole('button', { name: /Gönderiliyor/ })).toBeInTheDocument();
      expect(screen.queryByText('Gönder')).not.toBeInTheDocument();
    });

    it('keeps children when loadingText is omitted', () => {
      render(<Button loading>Gönder</Button>);
      expect(screen.getByRole('button', { name: /Gönder/ })).toBeInTheDocument();
    });

    it('hides the leading icon while loading (replaced by spinner)', () => {
      render(
        <Button loading leadingIcon={<svg data-testid="lead" aria-hidden="true" />}>
          Gönder
        </Button>,
      );
      expect(screen.queryByTestId('lead')).not.toBeInTheDocument();
    });

    it('hides the trailing icon while loading', () => {
      render(
        <Button loading trailingIcon={<svg data-testid="trail" aria-hidden="true" />}>
          Gönder
        </Button>,
      );
      expect(screen.queryByTestId('trail')).not.toBeInTheDocument();
    });
  });

  describe('click handling', () => {
    it('fires onClick when clicked', async () => {
      const onClick = vi.fn();
      const { user } = render(<Button onClick={onClick}>Tıkla</Button>);
      await user.click(screen.getByRole('button'));
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('does not fire onClick while loading (disabled)', async () => {
      const onClick = vi.fn();
      const { user } = render(
        <Button loading onClick={onClick}>
          Tıkla
        </Button>,
      );
      await user.click(screen.getByRole('button'));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('asChild', () => {
    it('renders the child element with button classes', () => {
      render(
        <Button asChild>
          <a href="https://example.com" data-testid="link">
            Git
          </a>
        </Button>,
      );
      const link = screen.getByTestId('link');
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', 'https://example.com');
    });
  });
});
