import { describe, expect, it, vi } from 'vitest';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { render, screen } from '../../helpers/render';

describe('Alert primitive', () => {
  describe('default icon per tone', () => {
    it('renders a default icon for info tone when none is provided', () => {
      render(
        <Alert tone="info">
          <AlertDescription>Bilgi</AlertDescription>
        </Alert>,
      );
      // Default icon renders as an SVG child of the alert.
      const alert = screen.getByRole('alert');
      expect(alert.querySelector('svg')).not.toBeNull();
    });

    it('renders a default icon for success tone', () => {
      render(
        <Alert tone="success">
          <AlertTitle>Başarılı</AlertTitle>
        </Alert>,
      );
      expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull();
    });
  });

  describe('icon prop', () => {
    it('renders a custom icon when provided', () => {
      render(
        <Alert tone="info" icon={<svg data-testid="custom" aria-hidden="true" />}>
          <AlertDescription>x</AlertDescription>
        </Alert>,
      );
      expect(screen.getByTestId('custom')).toBeInTheDocument();
    });

    it('suppresses the default icon when icon={null}', () => {
      render(
        <Alert tone="info" icon={null}>
          <AlertDescription>x</AlertDescription>
        </Alert>,
      );
      // No SVG should be present inside the alert.
      const svgs = screen.getByRole('alert').querySelectorAll('svg');
      expect(svgs.length).toBe(0);
    });
  });

  describe('onDismiss prop', () => {
    it('renders a dismiss button with the translated label', () => {
      render(
        <Alert tone="info" onDismiss={vi.fn()} dismissLabel="Kapat">
          <AlertDescription>x</AlertDescription>
        </Alert>,
      );
      expect(screen.getByRole('button', { name: 'Kapat' })).toBeInTheDocument();
    });

    it('fires onDismiss when the button is clicked', async () => {
      const onDismiss = vi.fn();
      const { user } = render(
        <Alert tone="info" onDismiss={onDismiss} dismissLabel="Kapat">
          <AlertDescription>x</AlertDescription>
        </Alert>,
      );
      await user.click(screen.getByRole('button', { name: 'Kapat' }));
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('does not render the dismiss button when onDismiss is omitted', () => {
      render(
        <Alert tone="info">
          <AlertDescription>x</AlertDescription>
        </Alert>,
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
