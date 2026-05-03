import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { InlineEdit } from '@/components/patterns/inline-edit';

import { render, screen } from '../helpers/render';

describe('<InlineEdit>', () => {
  describe('display mode', () => {
    it('renders the value as a button initially', () => {
      render(<InlineEdit value="Ana Mağaza" onCommit={() => {}} />);
      expect(screen.getByRole('button', { name: /Ana Mağaza/ })).toBeInTheDocument();
    });

    it('falls back to the placeholder when value is empty', () => {
      render(<InlineEdit value="" onCommit={() => {}} placeholder="Mağaza adı ekle" />);
      expect(screen.getByText('Mağaza adı ekle')).toBeInTheDocument();
    });

    it('uses renderDisplay when supplied', () => {
      render(
        <InlineEdit
          value="42"
          onCommit={() => {}}
          renderDisplay={(v) => <span data-testid="custom">{v} TL</span>}
        />,
      );
      expect(screen.getByTestId('custom').textContent).toBe('42 TL');
    });
  });

  describe('enter edit mode', () => {
    it('replaces the button with an input on click', async () => {
      const { user, container } = render(<InlineEdit value="Ana Mağaza" onCommit={() => {}} />);
      await user.click(screen.getByRole('button'));
      const input = container.querySelector('input');
      expect(input).not.toBeNull();
      expect(input?.value).toBe('Ana Mağaza');
    });

    it('does not enter edit mode when disabled', async () => {
      const { user, container } = render(
        <InlineEdit value="Ana Mağaza" onCommit={() => {}} disabled />,
      );
      await user.click(screen.getByRole('button'));
      expect(container.querySelector('input')).toBeNull();
    });
  });

  describe('keyboard contract', () => {
    it('commits the draft on Enter', async () => {
      const onCommit = vi.fn();
      const { user, container } = render(<InlineEdit value="A" onCommit={onCommit} />);
      await user.click(screen.getByRole('button'));
      const input = container.querySelector('input') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'B{Enter}');
      expect(onCommit).toHaveBeenCalledWith('B');
    });

    it('discards the draft on Escape — onCommit not called', async () => {
      const onCommit = vi.fn();
      const { user, container } = render(<InlineEdit value="A" onCommit={onCommit} />);
      await user.click(screen.getByRole('button'));
      const input = container.querySelector('input') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'B{Escape}');
      expect(onCommit).not.toHaveBeenCalled();
      // After cancel, original value still rendered.
      expect(screen.getByRole('button', { name: /A/ })).toBeInTheDocument();
    });

    it('does not call onCommit when the draft equals the original value', async () => {
      const onCommit = vi.fn();
      const { user, container } = render(<InlineEdit value="A" onCommit={onCommit} />);
      await user.click(screen.getByRole('button'));
      const input = container.querySelector('input') as HTMLInputElement;
      await user.type(input, '{Enter}');
      expect(onCommit).not.toHaveBeenCalled();
    });
  });

  describe('blur behavior', () => {
    it('commits on blur when commitOnBlur=true (default)', async () => {
      const onCommit = vi.fn();
      const { user, container } = render(<InlineEdit value="A" onCommit={onCommit} />);
      await user.click(screen.getByRole('button'));
      const input = container.querySelector('input') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'C');
      input.blur();
      expect(onCommit).toHaveBeenCalledWith('C');
    });

    it('discards on blur when commitOnBlur=false', async () => {
      const onCommit = vi.fn();
      const { user, container } = render(
        <InlineEdit value="A" onCommit={onCommit} commitOnBlur={false} />,
      );
      await user.click(screen.getByRole('button'));
      const input = container.querySelector('input') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'C');
      input.blur();
      expect(onCommit).not.toHaveBeenCalled();
    });
  });
});
