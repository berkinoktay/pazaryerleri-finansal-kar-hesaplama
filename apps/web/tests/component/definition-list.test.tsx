import { describe, expect, it } from 'vitest';

import { DefinitionList, type DefinitionListItem } from '@/components/patterns/definition-list';

import { render, screen, within } from '../helpers/render';

const ITEMS: DefinitionListItem[] = [
  { term: 'Sipariş No', description: 'TY-2948021' },
  { term: 'Müşteri', description: 'Ayşe Demir' },
  { term: 'Ciro', description: '₺249,90', hint: 'KDV dahil' },
];

describe('<DefinitionList>', () => {
  describe('semantic shape', () => {
    it('renders a <dl> with one <dt>/<dd> pair per item', () => {
      const { container } = render(<DefinitionList items={ITEMS} />);
      const dl = container.querySelector('dl');
      expect(dl).not.toBeNull();
      expect(dl?.querySelectorAll('dt')).toHaveLength(ITEMS.length);
      expect(dl?.querySelectorAll('dd')).toHaveLength(ITEMS.length);
    });

    it('renders the term text and description text for each item', () => {
      render(<DefinitionList items={ITEMS} />);
      expect(screen.getByText('Sipariş No')).toBeInTheDocument();
      expect(screen.getByText('TY-2948021')).toBeInTheDocument();
      expect(screen.getByText('Müşteri')).toBeInTheDocument();
      expect(screen.getByText('Ayşe Demir')).toBeInTheDocument();
    });

    it('renders the hint when provided', () => {
      render(<DefinitionList items={ITEMS} />);
      expect(screen.getByText('KDV dahil')).toBeInTheDocument();
    });
  });

  describe('layouts', () => {
    it('inline layout (default) wraps items in a 2-col grid', () => {
      const { container } = render(<DefinitionList items={ITEMS} />);
      const dl = container.querySelector('dl');
      expect(dl?.className).toContain('grid-cols-[max-content_1fr]');
    });

    it('stacked layout wraps each item in its own column container', () => {
      const { container } = render(<DefinitionList items={ITEMS} layout="stacked" />);
      const dl = container.querySelector('dl');
      // Stacked variant uses flex-col on the dl, not the grid.
      expect(dl?.className).not.toContain('grid-cols-[max-content_1fr]');
      expect(dl?.className).toContain('flex-col');
    });
  });

  describe('alignRight', () => {
    it('adds tabular-nums + text-right to descriptions in inline mode', () => {
      const { container } = render(<DefinitionList items={ITEMS} alignRight />);
      const dd = container.querySelector('dd');
      expect(dd?.className).toContain('text-right');
      expect(dd?.className).toContain('tabular-nums');
    });
  });

  describe('descriptions accept React nodes', () => {
    it('renders a node-typed description verbatim', () => {
      render(
        <DefinitionList
          items={[
            {
              term: 'Durum',
              description: <span data-testid="status-badge">Teslim edildi</span>,
            },
          ]}
        />,
      );
      expect(screen.getByTestId('status-badge')).toBeInTheDocument();
    });
  });

  describe('empty list', () => {
    it('renders an empty <dl> with no rows', () => {
      const { container } = render(<DefinitionList items={[]} />);
      const dl = container.querySelector('dl');
      expect(dl).not.toBeNull();
      expect(within(dl!).queryAllByRole('term')).toHaveLength(0);
    });
  });
});
