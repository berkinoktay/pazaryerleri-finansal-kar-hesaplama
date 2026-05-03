import { describe, expect, it } from 'vitest';

import { Sparkline } from '@/components/patterns/sparkline';

import { render, screen } from '../helpers/render';

const SERIES = [10, 12, 14, 13, 18, 22, 20, 25];

describe('<Sparkline>', () => {
  describe('empty data', () => {
    it('renders a placeholder box (no svg) when data=[]', () => {
      const { container } = render(<Sparkline data={[]} />);
      expect(container.querySelector('svg')).toBeNull();
    });

    it('placeholder respects ariaLabel for screen readers when supplied', () => {
      render(<Sparkline data={[]} ariaLabel="Veri yok" />);
      expect(screen.getByRole('img', { name: 'Veri yok' })).toBeInTheDocument();
    });

    it('placeholder is decorative (presentation role) when no ariaLabel', () => {
      const { container } = render(<Sparkline data={[]} />);
      expect(container.firstElementChild?.getAttribute('role')).toBe('presentation');
    });
  });

  describe('non-empty wrapper', () => {
    // Recharts' ResponsiveContainer needs real layout dimensions to mount
    // the inner SVG, which happy-dom doesn't provide. Tests focus on what
    // Sparkline itself owns — wrapper role / aria / inline sizing — rather
    // than recharts' internal render output (covered by the design-system
    // showcase + manual DevTools verification).
    it('exposes the chart as role="img" when ariaLabel is provided', () => {
      render(<Sparkline data={SERIES} ariaLabel="Son 14 gün" />);
      expect(screen.getByRole('img', { name: 'Son 14 gün' })).toBeInTheDocument();
    });

    it('treats the chart as decorative (role="presentation") without ariaLabel', () => {
      const { container } = render(<Sparkline data={SERIES} />);
      expect(container.firstElementChild?.getAttribute('role')).toBe('presentation');
    });

    it('accepts plain numbers and { value } objects without throwing', () => {
      // Smoke check: data normalization doesn't break either input shape.
      const numbers = render(<Sparkline data={[1, 2, 3]} />);
      const points = render(<Sparkline data={[{ value: 1 }, { value: 2 }, { value: 3 }]} />);
      expect(numbers.container.firstElementChild).not.toBeNull();
      expect(points.container.firstElementChild).not.toBeNull();
    });
  });

  describe('sizing', () => {
    it('inline-style width + height match the supplied props', () => {
      const { container } = render(<Sparkline data={SERIES} width={120} height={32} />);
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.width).toBe('120px');
      expect(wrapper.style.height).toBe('32px');
    });

    it('empty-state placeholder also respects the supplied size', () => {
      const { container } = render(<Sparkline data={[]} width={100} height={20} />);
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.width).toBe('100px');
      expect(wrapper.style.height).toBe('20px');
    });
  });
});
