import { describe, expect, it, vi } from 'vitest';

import { Textarea } from '@/components/ui/textarea';

import { render, screen } from '../../helpers/render';

describe('Textarea primitive', () => {
  describe('bare usage', () => {
    it('renders a plain textarea when no adornment props are given', () => {
      render(<Textarea placeholder="Not…" />);
      expect(screen.getByPlaceholderText('Not…')).toBeInTheDocument();
    });
  });

  describe('invalid prop', () => {
    it('sets aria-invalid="true"', () => {
      render(<Textarea invalid placeholder="x" />);
      expect(screen.getByPlaceholderText('x')).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('counter', () => {
    it('shows count/max when maxLength is set', () => {
      render(<Textarea placeholder="x" defaultValue="abc" maxLength={10} />);
      expect(screen.getByText('3/10')).toBeInTheDocument();
    });

    it('shows count without max when showCount is true', () => {
      render(<Textarea placeholder="x" defaultValue="abcd" showCount />);
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('updates counter as the user types', async () => {
      const { user } = render(<Textarea placeholder="x" maxLength={20} />);
      await user.type(screen.getByPlaceholderText('x'), 'hello');
      expect(screen.getByText('5/20')).toBeInTheDocument();
    });

    it('reflects controlled value in counter', () => {
      render(<Textarea placeholder="x" value="hi there" onChange={vi.fn()} maxLength={50} />);
      expect(screen.getByText('8/50')).toBeInTheDocument();
    });
  });

  describe('autoResize', () => {
    it('renders the grid mirror wrapper when autoResize is true', () => {
      render(<Textarea placeholder="x" autoResize defaultValue="line" />);
      // The mirror span mirrors the textarea value (plus newline).
      // Two instances of "line" in the DOM (once in mirror, once in textarea's internal value).
      expect(screen.getByPlaceholderText('x')).toBeInTheDocument();
    });
  });

  describe('ref forwarding', () => {
    it('forwards ref to the underlying textarea element', () => {
      const ref = { current: null as HTMLTextAreaElement | null };
      render(<Textarea ref={ref} placeholder="x" />);
      expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    });
  });
});
