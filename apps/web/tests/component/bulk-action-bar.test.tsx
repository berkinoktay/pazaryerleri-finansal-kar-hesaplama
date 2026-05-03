import { describe, expect, it, vi } from 'vitest';

import { BulkActionBar, type BulkAction } from '@/components/patterns/bulk-action-bar';

import { render, screen } from '../helpers/render';

function makeActions(overrides: Partial<BulkAction>[] = []): BulkAction[] {
  const defaults: BulkAction[] = [
    { id: 'export', label: 'Dışa aktar', onClick: vi.fn() },
    { id: 'tag', label: 'Etiketle', onClick: vi.fn() },
    { id: 'delete', label: 'Sil', onClick: vi.fn(), tone: 'destructive' },
  ];
  return defaults.map((action, index) => ({ ...action, ...(overrides[index] ?? {}) }));
}

describe('<BulkActionBar>', () => {
  describe('visibility', () => {
    it('renders nothing when selectedCount is 0', () => {
      const { container } = render(
        <BulkActionBar selectedCount={0} onClear={vi.fn()} actions={makeActions()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders the bar when selectedCount > 0', () => {
      render(<BulkActionBar selectedCount={3} onClear={vi.fn()} actions={makeActions()} />);
      expect(screen.getByRole('region', { name: /3/ })).toBeInTheDocument();
    });
  });

  describe('count label', () => {
    it('uses the default Turkish "{N} seçili" copy when no countLabel given', () => {
      render(<BulkActionBar selectedCount={5} onClear={vi.fn()} actions={[]} />);
      expect(screen.getByText('5 seçili')).toBeInTheDocument();
    });

    it('uses the supplied countLabel function for custom copy', () => {
      render(
        <BulkActionBar
          selectedCount={4}
          onClear={vi.fn()}
          actions={[]}
          countLabel={(count) => `${count} sipariş seçili`}
        />,
      );
      expect(screen.getByText('4 sipariş seçili')).toBeInTheDocument();
    });
  });

  describe('clear button', () => {
    it('uses the localized aria-label and fires onClear when clicked', async () => {
      const onClear = vi.fn();
      const { user } = render(
        <BulkActionBar selectedCount={2} onClear={onClear} actions={[]} clearLabel="Temizle" />,
      );

      await user.click(screen.getByRole('button', { name: 'Temizle' }));
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  describe('actions', () => {
    it('renders one button per action with its label', () => {
      render(<BulkActionBar selectedCount={1} onClear={vi.fn()} actions={makeActions()} />);
      expect(screen.getByRole('button', { name: 'Dışa aktar' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Etiketle' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sil' })).toBeInTheDocument();
    });

    it('fires onClick when an action button is clicked', async () => {
      const onExport = vi.fn();
      const { user } = render(
        <BulkActionBar
          selectedCount={3}
          onClear={vi.fn()}
          actions={makeActions([{ onClick: onExport }])}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Dışa aktar' }));
      expect(onExport).toHaveBeenCalledOnce();
    });

    it('disables an action when its disabled flag is set', () => {
      render(
        <BulkActionBar
          selectedCount={1}
          onClear={vi.fn()}
          actions={makeActions([{}, {}, { disabled: true }])}
        />,
      );
      expect(screen.getByRole('button', { name: 'Sil' })).toBeDisabled();
    });

    it('omits the action group entirely when actions=[]', () => {
      render(<BulkActionBar selectedCount={2} onClear={vi.fn()} actions={[]} clearLabel="X" />);
      // Only the clear button should be in the bar.
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });
  });

  describe('position', () => {
    it('floating wraps the bar in a fixed pointer-events container by default', () => {
      const { container } = render(
        <BulkActionBar selectedCount={1} onClear={vi.fn()} actions={[]} />,
      );
      // Floating wrapper has `fixed` positioning class on the outer div.
      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toMatch(/\bfixed\b/);
    });

    it('inline renders the bar directly in document flow without the fixed wrapper', () => {
      const { container } = render(
        <BulkActionBar selectedCount={1} onClear={vi.fn()} actions={[]} position="inline" />,
      );
      // Inline returns the bar (a region) without the outer fixed positioner.
      const wrapper = container.firstElementChild;
      expect(wrapper?.className).not.toMatch(/\bfixed\b/);
      expect(wrapper?.getAttribute('role')).toBe('region');
    });
  });
});
