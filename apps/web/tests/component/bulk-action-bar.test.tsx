import { describe, expect, it, vi } from 'vitest';

import { BulkActionBar, type BulkAction } from '@/components/patterns/bulk-action-bar';

import { render, screen, waitFor } from '../helpers/render';

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
    it('uses the shared i18n selection count copy when no countLabel given', () => {
      render(<BulkActionBar selectedCount={5} onClear={vi.fn()} actions={[]} />);
      // Default reads common.dataTable.selection.selectedCount ("{count} satır seçili").
      expect(screen.getByText('5 satır seçili')).toBeInTheDocument();
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

  describe('group breaks', () => {
    it('renders a vertical separator before an action with groupBreakBefore=true', () => {
      const { container } = render(
        <BulkActionBar
          selectedCount={1}
          onClear={vi.fn()}
          actions={[
            { id: 'a1', label: 'Maliyet ekle', onClick: vi.fn() },
            { id: 'a2', label: 'Maliyet kaldır', onClick: vi.fn() },
            // Third action starts the second visual group.
            { id: 'a3', label: 'Desi ayarla', onClick: vi.fn(), groupBreakBefore: true },
          ]}
        />,
      );
      // Two separators expected total: one between count-label/actions
      // (the original one) plus one before the groupBreakBefore action.
      const separators = container.querySelectorAll('[data-orientation="vertical"]');
      expect(separators.length).toBe(2);
      // All three action buttons still rendered.
      expect(screen.getByRole('button', { name: 'Maliyet ekle' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Desi ayarla' })).toBeInTheDocument();
    });

    it('does not render a leading separator when the first action has groupBreakBefore=true', () => {
      const { container } = render(
        <BulkActionBar
          selectedCount={1}
          onClear={vi.fn()}
          actions={[
            // groupBreakBefore on the FIRST action must be ignored — otherwise
            // the bar would lead with a hanging separator.
            { id: 'a1', label: 'İlk aksiyon', onClick: vi.fn(), groupBreakBefore: true },
            { id: 'a2', label: 'İkinci aksiyon', onClick: vi.fn() },
          ]}
        />,
      );
      const separators = container.querySelectorAll('[data-orientation="vertical"]');
      // Only the original between count-label and actions; no extra leading one.
      expect(separators.length).toBe(1);
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

  describe('minSelected threshold', () => {
    it('stays hidden until selectedCount reaches minSelected', () => {
      const { container } = render(
        <BulkActionBar selectedCount={1} onClear={vi.fn()} actions={[]} minSelected={2} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('shows once selectedCount meets minSelected', () => {
      render(<BulkActionBar selectedCount={2} onClear={vi.fn()} actions={[]} minSelected={2} />);
      expect(screen.getByRole('region')).toBeInTheDocument();
    });
  });

  describe('busy state', () => {
    it('marks the region aria-busy and disables every action + the clear button', () => {
      render(
        <BulkActionBar
          selectedCount={3}
          onClear={vi.fn()}
          actions={makeActions()}
          busy
          clearLabel="Temizle"
        />,
      );
      expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: 'Temizle' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Dışa aktar' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sil' })).toBeDisabled();
    });

    it('does not clear on Escape while busy', async () => {
      const onClear = vi.fn();
      const { user } = render(
        <BulkActionBar selectedCount={3} onClear={onClear} actions={[]} busy />,
      );
      await user.keyboard('{Escape}');
      expect(onClear).not.toHaveBeenCalled();
    });
  });

  describe('escape to clear', () => {
    it('fires onClear when Escape is pressed', async () => {
      const onClear = vi.fn();
      const { user } = render(<BulkActionBar selectedCount={2} onClear={onClear} actions={[]} />);
      await user.keyboard('{Escape}');
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  describe('exit animation', () => {
    it('carries symmetric enter/exit animation classes driven by data-state', () => {
      render(<BulkActionBar selectedCount={2} onClear={vi.fn()} actions={[]} position="inline" />);
      const region = screen.getByRole('region');
      expect(region).toHaveAttribute('data-state', 'open');
      expect(region.className).toMatch(/data-\[state=open\]:motion-safe:animate-in/);
      expect(region.className).toMatch(/data-\[state=closed\]:motion-safe:animate-out/);
    });

    it('lingers in the closed state, then unmounts after the selection clears', async () => {
      const { rerender, container } = render(
        <BulkActionBar selectedCount={2} onClear={vi.fn()} actions={[]} position="inline" />,
      );
      expect(screen.getByRole('region')).toBeInTheDocument();
      rerender(
        <BulkActionBar selectedCount={0} onClear={vi.fn()} actions={[]} position="inline" />,
      );
      // Still mounted during the exit, now flagged closed so animate-out plays.
      expect(screen.getByRole('region')).toHaveAttribute('data-state', 'closed');
      // Unmounts once the exit window elapses.
      await waitFor(() => expect(container.firstChild).toBeNull());
    });
  });

  describe('overflow', () => {
    it('collapses actions beyond overflowAfter into a More dropdown', async () => {
      const onClickFourth = vi.fn();
      const { user } = render(
        <BulkActionBar
          selectedCount={1}
          onClear={vi.fn()}
          overflowAfter={2}
          actions={[
            { id: 'a1', label: 'Bir', onClick: vi.fn() },
            { id: 'a2', label: 'İki', onClick: vi.fn() },
            { id: 'a3', label: 'Üç', onClick: vi.fn() },
            { id: 'a4', label: 'Dört', onClick: onClickFourth },
          ]}
        />,
      );
      // First two inline; the rest hidden behind a "More" menu.
      expect(screen.getByRole('button', { name: 'Bir' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'İki' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Üç' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Daha fazla' }));
      await user.click(screen.getByRole('menuitem', { name: 'Dört' }));
      expect(onClickFourth).toHaveBeenCalledOnce();
    });

    it('disables the More trigger while busy (overflow path is suspended too)', () => {
      render(
        <BulkActionBar
          selectedCount={3}
          onClear={vi.fn()}
          busy
          overflowAfter={2}
          actions={[
            { id: 'a1', label: 'Bir', onClick: vi.fn() },
            { id: 'a2', label: 'İki', onClick: vi.fn() },
            { id: 'a3', label: 'Üç', onClick: vi.fn() },
            { id: 'a4', label: 'Dört', onClick: vi.fn() },
          ]}
        />,
      );
      expect(screen.getByRole('button', { name: 'Daha fazla' })).toBeDisabled();
    });
  });
});
