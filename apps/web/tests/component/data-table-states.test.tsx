import { type ColumnDef } from '@tanstack/react-table';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from '@/components/patterns/data-table';

import { render, screen } from '../helpers/render';

interface Row {
  name: string;
}

const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Ad' }];

// Copy resolved from common.dataTable.* (tr.json) — asserting these proves the
// four states render DISTINCT, non-hedging messages.
const FIRST_RUN_TITLE = 'Gösterilecek kayıt yok';
const NO_RESULTS_TITLE = 'Eşleşen kayıt yok';
const ERROR_TITLE = 'Veriler yüklenemedi';

describe('<DataTable> body states', () => {
  describe('first-run (zero rows, no filters)', () => {
    it('shows the first-run empty state', () => {
      render(<DataTable columns={columns} data={[]} />);
      expect(screen.getByText(FIRST_RUN_TITLE)).toBeInTheDocument();
      expect(screen.queryByText(NO_RESULTS_TITLE)).not.toBeInTheDocument();
    });

    it('lets the explicit `empty` slot override the default', () => {
      render(<DataTable columns={columns} data={[]} empty={<div>Mağaza bağla</div>} />);
      expect(screen.getByText('Mağaza bağla')).toBeInTheDocument();
      expect(screen.queryByText(FIRST_RUN_TITLE)).not.toBeInTheDocument();
    });
  });

  describe('no-results (zero rows, filters active)', () => {
    it('shows the no-results state distinct from first-run', () => {
      render(<DataTable columns={columns} data={[]} hasActiveFilters onClearFilters={vi.fn()} />);
      expect(screen.getByText(NO_RESULTS_TITLE)).toBeInTheDocument();
      expect(screen.queryByText(FIRST_RUN_TITLE)).not.toBeInTheDocument();
    });

    it('fires onClearFilters from the Clear-filters button', async () => {
      const onClearFilters = vi.fn();
      const { user } = render(
        <DataTable columns={columns} data={[]} hasActiveFilters onClearFilters={onClearFilters} />,
      );
      await user.click(screen.getByRole('button', { name: 'Filtreleri temizle' }));
      expect(onClearFilters).toHaveBeenCalledOnce();
    });

    it('lets the explicit `noResultsState` slot override the default', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          hasActiveFilters
          noResultsState={<div>Özel sonuç yok</div>}
        />,
      );
      expect(screen.getByText('Özel sonuç yok')).toBeInTheDocument();
      expect(screen.queryByText(NO_RESULTS_TITLE)).not.toBeInTheDocument();
    });

    it('back-compat: reuses the `empty` slot for no-results when no noResultsState is given', () => {
      // A consumer that passes only `empty` (e.g. a self-branching feature node)
      // keeps identical behaviour: the empty node renders for BOTH first-run and
      // filtered-to-zero via the `noResultsState ?? empty ?? default` fallthrough.
      render(
        <DataTable
          columns={columns}
          data={[]}
          hasActiveFilters
          empty={<div>Geri-uyumlu boş</div>}
        />,
      );
      expect(screen.getByText('Geri-uyumlu boş')).toBeInTheDocument();
      expect(screen.queryByText(NO_RESULTS_TITLE)).not.toBeInTheDocument();
    });
  });

  describe('error', () => {
    it('shows the error state and fires onRetry', async () => {
      const onRetry = vi.fn();
      const { user } = render(<DataTable columns={columns} data={[]} error onRetry={onRetry} />);
      expect(screen.getByText(ERROR_TITLE)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Tekrar dene' }));
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it('takes precedence over the filtered no-results state', () => {
      render(<DataTable columns={columns} data={[]} error hasActiveFilters />);
      expect(screen.getByText(ERROR_TITLE)).toBeInTheDocument();
      expect(screen.queryByText(NO_RESULTS_TITLE)).not.toBeInTheDocument();
    });
  });

  describe('loading', () => {
    it('shows skeletons, not an empty/error message', () => {
      render(<DataTable columns={columns} data={[]} loading hasActiveFilters error />);
      // Loading wins the precedence ladder: no empty/no-results/error copy.
      expect(screen.queryByText(FIRST_RUN_TITLE)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_RESULTS_TITLE)).not.toBeInTheDocument();
      expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument();
      expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('rows present', () => {
    it('renders rows and no state message', () => {
      render(
        <DataTable columns={columns} data={[{ name: 'Ürün A' }]} hasActiveFilters error={false} />,
      );
      expect(screen.getByText('Ürün A')).toBeInTheDocument();
      expect(screen.queryByText(NO_RESULTS_TITLE)).not.toBeInTheDocument();
    });
  });

  describe('hideToolbarOnEmpty', () => {
    const TOOLBAR = 'ARAÇ ÇUBUĞU';
    const toolbar = () => <div>{TOOLBAR}</div>;

    it('hides the toolbar only in the first-run state', () => {
      render(<DataTable columns={columns} data={[]} hideToolbarOnEmpty toolbar={toolbar} />);
      expect(screen.queryByText(TOOLBAR)).not.toBeInTheDocument();
    });

    it('keeps the toolbar mounted in the no-results state (user needs to clear filters)', () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          hasActiveFilters
          onClearFilters={vi.fn()}
          hideToolbarOnEmpty
          toolbar={toolbar}
        />,
      );
      expect(screen.getByText(TOOLBAR)).toBeInTheDocument();
    });

    it('keeps the toolbar mounted in the error state (user needs to retry)', () => {
      render(<DataTable columns={columns} data={[]} error hideToolbarOnEmpty toolbar={toolbar} />);
      expect(screen.getByText(TOOLBAR)).toBeInTheDocument();
    });

    it('keeps the toolbar in first-run when hideToolbarOnEmpty is not set (default)', () => {
      render(<DataTable columns={columns} data={[]} toolbar={toolbar} />);
      expect(screen.getByText(TOOLBAR)).toBeInTheDocument();
    });
  });
});
