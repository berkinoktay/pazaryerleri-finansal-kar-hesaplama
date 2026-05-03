import { describe, expect, it } from 'vitest';

import { MappedBadge } from '@/components/patterns/mapped-badge';

import { render, screen } from '../helpers/render';

type Status = 'active' | 'paused' | 'blocked';

const TONE_MAP = {
  active: 'success',
  paused: 'warning',
  blocked: 'destructive',
} as const;

const LABEL_MAP: Record<Status, string> = {
  active: 'Aktif',
  paused: 'Duraklatıldı',
  blocked: 'Engellenmiş',
};

describe('<MappedBadge>', () => {
  describe('label rendering', () => {
    it('renders the labelMap entry for the current value', () => {
      render(<MappedBadge<Status> value="active" toneMap={TONE_MAP} labelMap={LABEL_MAP} />);
      expect(screen.getByText('Aktif')).toBeInTheDocument();
    });

    it('switches the rendered label when value changes', () => {
      const { rerender } = render(
        <MappedBadge<Status> value="active" toneMap={TONE_MAP} labelMap={LABEL_MAP} />,
      );
      expect(screen.getByText('Aktif')).toBeInTheDocument();

      rerender(<MappedBadge<Status> value="blocked" toneMap={TONE_MAP} labelMap={LABEL_MAP} />);
      expect(screen.queryByText('Aktif')).not.toBeInTheDocument();
      expect(screen.getByText('Engellenmiş')).toBeInTheDocument();
    });
  });

  describe('overflow chip', () => {
    it('omits the +N chip when overflowCount is undefined', () => {
      render(<MappedBadge<Status> value="active" toneMap={TONE_MAP} labelMap={LABEL_MAP} />);
      expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    });

    it('omits the +N chip when overflowCount is 0', () => {
      render(
        <MappedBadge<Status>
          value="active"
          toneMap={TONE_MAP}
          labelMap={LABEL_MAP}
          overflowCount={0}
        />,
      );
      expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    });

    it('renders +N chip when overflowCount > 0', () => {
      render(
        <MappedBadge<Status>
          value="paused"
          toneMap={TONE_MAP}
          labelMap={LABEL_MAP}
          overflowCount={3}
        />,
      );
      expect(screen.getByText('Duraklatıldı')).toBeInTheDocument();
      expect(screen.getByText('+3')).toBeInTheDocument();
    });
  });

  describe('label nodes', () => {
    it('accepts React nodes (not just strings) in labelMap', () => {
      const labelMap: Record<Status, React.ReactNode> = {
        active: <span data-testid="active-node">Aktif (özel)</span>,
        paused: 'Duraklatıldı',
        blocked: 'Engellenmiş',
      };
      render(<MappedBadge<Status> value="active" toneMap={TONE_MAP} labelMap={labelMap} />);
      expect(screen.getByTestId('active-node')).toBeInTheDocument();
    });
  });
});
