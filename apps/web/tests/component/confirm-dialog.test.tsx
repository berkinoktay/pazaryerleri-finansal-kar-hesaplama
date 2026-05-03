import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { Button } from '@/components/ui/button';

import { render, screen, waitFor } from '../helpers/render';

interface ControlledHarnessProps {
  initialOpen?: boolean;
  onConfirm?: () => void | Promise<void>;
  loading?: boolean;
  tone?: 'destructive' | 'default';
  cancelLabel?: string;
}

function ControlledHarness({
  initialOpen = true,
  onConfirm = () => undefined,
  loading,
  tone,
  cancelLabel,
}: ControlledHarnessProps): React.ReactElement {
  const [open, setOpen] = React.useState(initialOpen);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Test başlığı"
      description="Test açıklaması"
      confirmLabel="Onayla"
      cancelLabel={cancelLabel}
      onConfirm={onConfirm}
      loading={loading}
      tone={tone}
    />
  );
}

describe('<ConfirmDialog>', () => {
  describe('controlled mode', () => {
    it('renders title + description + buttons when open', () => {
      render(<ControlledHarness />);
      expect(screen.getByRole('heading', { name: 'Test başlığı' })).toBeInTheDocument();
      expect(screen.getByText('Test açıklaması')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Onayla' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'İptal' })).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
      render(<ControlledHarness initialOpen={false} />);
      expect(screen.queryByRole('heading', { name: 'Test başlığı' })).not.toBeInTheDocument();
    });

    it('uses the localized cancelLabel when provided', () => {
      render(<ControlledHarness cancelLabel="Vazgeç" />);
      expect(screen.getByRole('button', { name: 'Vazgeç' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'İptal' })).not.toBeInTheDocument();
    });
  });

  describe('trigger mode', () => {
    it('opens the dialog when the trigger is clicked', async () => {
      const { user } = render(
        <ConfirmDialog
          trigger={<Button>Aç</Button>}
          title="Trigger başlığı"
          confirmLabel="Tamam"
          onConfirm={vi.fn()}
        />,
      );

      // Dialog content not in DOM until trigger is clicked.
      expect(screen.queryByRole('heading', { name: 'Trigger başlığı' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Aç' }));

      expect(screen.getByRole('heading', { name: 'Trigger başlığı' })).toBeInTheDocument();
    });
  });

  describe('confirmation', () => {
    it('fires onConfirm when the confirm button is clicked', async () => {
      const onConfirm = vi.fn();
      const { user } = render(<ControlledHarness onConfirm={onConfirm} />);

      await user.click(screen.getByRole('button', { name: 'Onayla' }));

      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('awaits an async onConfirm before closing the dialog', async () => {
      let resolve: (() => void) | undefined;
      const onConfirm = vi.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          }),
      );
      const { user } = render(<ControlledHarness onConfirm={onConfirm} />);

      await user.click(screen.getByRole('button', { name: 'Onayla' }));
      // Promise pending — dialog still open.
      expect(screen.getByRole('heading', { name: 'Test başlığı' })).toBeInTheDocument();

      resolve?.();
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Test başlığı' })).not.toBeInTheDocument();
      });
    });

    it('keeps the dialog open when onConfirm rejects', async () => {
      const onConfirm = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('failed'));
      const { user } = render(<ControlledHarness onConfirm={onConfirm} />);

      await user.click(screen.getByRole('button', { name: 'Onayla' }));

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledOnce();
      });
      // Dialog stays mounted on failure so the user can retry / cancel.
      expect(screen.getByRole('heading', { name: 'Test başlığı' })).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('disables both buttons when loading=true', () => {
      render(<ControlledHarness loading />);
      // When loading the spinner's status-role label shifts the confirm
      // button's accessible name to "Loading Onayla"; match with regex.
      expect(screen.getByRole('button', { name: /Onayla/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'İptal' })).toBeDisabled();
    });

    it('renders a status-role spinner inside the confirm button when loading', () => {
      render(<ControlledHarness loading />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('disables both buttons during async pending state', async () => {
      let resolve: (() => void) | undefined;
      const onConfirm = vi.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          }),
      );
      const { user } = render(<ControlledHarness onConfirm={onConfirm} />);

      await user.click(screen.getByRole('button', { name: 'Onayla' }));

      await waitFor(() => {
        // Confirm button's accessible name flips to "Loading Onayla" once
        // the spinner mounts mid-pending; match by regex.
        expect(screen.getByRole('button', { name: /Onayla/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'İptal' })).toBeDisabled();
      });

      resolve?.();
    });
  });

  describe('cancel', () => {
    it('clicking Cancel closes the dialog without firing onConfirm', async () => {
      const onConfirm = vi.fn();
      const { user } = render(<ControlledHarness onConfirm={onConfirm} />);

      await user.click(screen.getByRole('button', { name: 'İptal' }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'Test başlığı' })).not.toBeInTheDocument();
      });
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });
});
