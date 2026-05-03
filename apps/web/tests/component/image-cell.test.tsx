import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { ImageCell } from '@/components/patterns/image-cell';

import { fireEvent, render, screen } from '../helpers/render';

describe('<ImageCell>', () => {
  describe('with a real src', () => {
    it('renders an <img> with the supplied src + alt', () => {
      const { container } = render(
        <ImageCell src="https://cdn.example/x.jpg" alt="Trendyol kılıf" />,
      );
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('https://cdn.example/x.jpg');
      expect(img?.getAttribute('alt')).toBe('Trendyol kılıf');
    });

    it('marks the image as lazy + async-decoded for table-row friendliness', () => {
      const { container } = render(<ImageCell src="https://cdn.example/x.jpg" alt="x" />);
      const img = container.querySelector('img');
      expect(img?.getAttribute('loading')).toBe('lazy');
      expect(img?.getAttribute('decoding')).toBe('async');
    });

    it('falls back to the icon placeholder after an onError', () => {
      const { container } = render(
        <ImageCell src="https://cdn.example/missing.jpg" alt="missing" />,
      );
      const img = container.querySelector('img') as HTMLImageElement;
      // happy-dom doesn't auto-fire onError when the URL fails to load,
      // so simulate the failure through React's synthetic event system
      // (a raw dispatchEvent bypasses React's onError listener).
      fireEvent.error(img);
      expect(container.querySelector('img')).toBeNull();
      // The default fallback is the decorative Image01Icon (svg, role
      // not exposed because aria-hidden).
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });

  describe('missing src', () => {
    it('renders the icon fallback when src is null', () => {
      const { container } = render(<ImageCell src={null} alt="placeholder" />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).not.toBeNull();
    });

    it('renders the icon fallback when src is an empty string', () => {
      const { container } = render(<ImageCell src="" alt="placeholder" />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).not.toBeNull();
    });

    it('exposes role=img + alt label when fallback="initials"', () => {
      render(<ImageCell src={null} alt="Ayşe Yılmaz" fallback="initials" />);
      expect(screen.getByRole('img', { name: 'Ayşe Yılmaz' })).toBeInTheDocument();
    });
  });

  describe('initials extraction (fallback="initials")', () => {
    it('uses first + last initials for a multi-word name', () => {
      const { container } = render(<ImageCell src={null} alt="Ayşe Yılmaz" fallback="initials" />);
      // The visual initials live in an aria-hidden span inside the wrapper.
      const span = container.querySelector('[aria-hidden="true"]');
      expect(span?.textContent).toBe('AY');
    });

    it('uses the first two characters for a single-word name', () => {
      const { container } = render(<ImageCell src={null} alt="Single" fallback="initials" />);
      const span = container.querySelector('[aria-hidden="true"]');
      expect(span?.textContent).toBe('SI');
    });

    it('handles whitespace and empty alt gracefully', () => {
      const { container } = render(<ImageCell src={null} alt="   " fallback="initials" />);
      const span = container.querySelector('[aria-hidden="true"]');
      expect(span?.textContent).toBe('');
    });
  });

  describe('shape + size', () => {
    it('applies rounded-full when shape="circle"', () => {
      const { container } = render(<ImageCell src={null} alt="x" shape="circle" />);
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain('rounded-full');
    });

    it('applies rounded-md by default (square shape)', () => {
      const { container } = render(<ImageCell src={null} alt="x" />);
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toContain('rounded-md');
    });

    it.each(['sm', 'md', 'lg'] as const)(
      'applies the size-thumb-%s utility for size="%s"',
      (size) => {
        const { container } = render(<ImageCell src={null} alt="x" size={size} />);
        const wrapper = container.firstElementChild as HTMLElement;
        expect(wrapper.className).toContain(`size-thumb-${size}`);
      },
    );
  });
});
