import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { ProfitCell } from '@/components/patterns/profit-cell';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="tr"
      messages={trMessages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('<ProfitCell>', () => {
  describe('value rendering', () => {
    it('renders the formatted Currency value', () => {
      renderWithIntl(<ProfitCell value={new Decimal('48120.80')} />);
      // Currency formatter renders ₺ + tr-TR thousand grouping; assert
      // the digit grouping is present rather than the exact glyph.
      expect(screen.getByText(/48\.120/)).toBeInTheDocument();
    });

    it('accepts a plain number value', () => {
      renderWithIntl(<ProfitCell value={1284} />);
      expect(screen.getByText(/1\.284/)).toBeInTheDocument();
    });
  });

  describe('delta', () => {
    it('renders the TrendDelta chip when delta is provided', () => {
      const { container } = renderWithIntl(
        <ProfitCell value={new Decimal('1000')} delta={{ percent: 12.4 }} />,
      );
      // TrendDelta exposes its own text — match a percent fragment.
      expect(container.textContent).toContain('12,4');
    });

    it('omits the TrendDelta chip when delta is not provided', () => {
      const { container } = renderWithIntl(<ProfitCell value={new Decimal('1000')} />);
      // No delta means no percent-formatted token in the cell.
      expect(container.textContent).not.toMatch(/%/);
    });

    it('passes through goodDirection to TrendDelta (down for cost cells)', () => {
      // Smoke-check: rendering with goodDirection=down does not throw.
      // Visual tone verification belongs in the TrendDelta test suite;
      // here we just confirm the prop reaches its consumer.
      renderWithIntl(
        <ProfitCell value={new Decimal('3250')} delta={{ percent: 14.2, goodDirection: 'down' }} />,
      );
      expect(screen.getByText(/14,2/)).toBeInTheDocument();
    });
  });

  describe('layout', () => {
    it('stacked (default) wraps the value + delta in a flex-col container', () => {
      const { container } = renderWithIntl(
        <ProfitCell value={new Decimal('100')} delta={{ percent: 1 }} />,
      );
      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain('flex-col');
    });

    it('inline lays the value + delta out on the same row', () => {
      const { container } = renderWithIntl(
        <ProfitCell value={new Decimal('100')} delta={{ percent: 1 }} layout="inline" />,
      );
      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain('inline-flex');
      expect(wrapper?.className).not.toContain('flex-col');
    });
  });

  describe('alignment', () => {
    it('right alignment (default) adds text-right + items-end in stacked mode', () => {
      const { container } = renderWithIntl(<ProfitCell value={new Decimal('100')} />);
      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain('text-right');
      expect(wrapper?.className).toContain('items-end');
    });

    it('left alignment swaps to text-left + items-start in stacked mode', () => {
      const { container } = renderWithIntl(<ProfitCell value={new Decimal('100')} align="left" />);
      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain('text-left');
      expect(wrapper?.className).toContain('items-start');
    });

    it('right alignment in inline mode adds justify-end', () => {
      const { container } = renderWithIntl(
        <ProfitCell value={new Decimal('100')} layout="inline" />,
      );
      const wrapper = container.firstElementChild;
      expect(wrapper?.className).toContain('justify-end');
    });
  });
});
