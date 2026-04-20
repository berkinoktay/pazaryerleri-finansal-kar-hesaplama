import { describe, expect, it, vi } from 'vitest';

import { Input } from '@/components/ui/input';

import { render, screen } from '../../helpers/render';

describe('Input primitive', () => {
  describe('bare usage (no adornments)', () => {
    it('renders a plain input when no adornment props are provided', () => {
      render(<Input placeholder="Ara…" />);
      expect(screen.getByPlaceholderText('Ara…')).toBeInTheDocument();
    });

    it('forwards additional props to the input element', () => {
      render(<Input data-testid="plain" type="email" autoComplete="email" />);
      const input = screen.getByTestId('plain');
      expect(input).toHaveAttribute('type', 'email');
      expect(input).toHaveAttribute('autoComplete', 'email');
    });
  });

  describe('invalid prop', () => {
    it('sets aria-invalid="true" on the input element', () => {
      render(<Input invalid placeholder="x" />);
      expect(screen.getByPlaceholderText('x')).toHaveAttribute('aria-invalid', 'true');
    });

    it('does not set aria-invalid when omitted', () => {
      render(<Input placeholder="x" />);
      expect(screen.getByPlaceholderText('x')).not.toHaveAttribute('aria-invalid');
    });
  });

  describe('leadingIcon slot', () => {
    it('renders the leading icon when provided', () => {
      render(
        <Input placeholder="Ara…" leadingIcon={<svg data-testid="lead" aria-hidden="true" />} />,
      );
      expect(screen.getByTestId('lead')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Ara…')).toBeInTheDocument();
    });
  });

  describe('trailingIcon slot', () => {
    it('renders the trailing icon when provided', () => {
      render(
        <Input placeholder="x" trailingIcon={<svg data-testid="trail" aria-hidden="true" />} />,
      );
      expect(screen.getByTestId('trail')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('sets aria-busy="true" when loading', () => {
      render(<Input loading placeholder="x" />);
      expect(screen.getByPlaceholderText('x')).toHaveAttribute('aria-busy', 'true');
    });

    it('renders a spinner with the translated loading label', () => {
      render(<Input loading loadingLabel="Yükleniyor" placeholder="x" />);
      expect(screen.getByRole('status', { name: 'Yükleniyor' })).toBeInTheDocument();
    });

    it('does not disable the input when loading (async autocomplete pattern)', () => {
      render(<Input loading placeholder="x" />);
      expect(screen.getByPlaceholderText('x')).not.toBeDisabled();
    });
  });

  describe('onClear prop (uncontrolled)', () => {
    it('does not render the clear button when value is empty', () => {
      render(<Input onClear={vi.fn()} clearLabel="Temizle" placeholder="x" />);
      expect(screen.queryByRole('button', { name: 'Temizle' })).not.toBeInTheDocument();
    });

    it('renders the clear button after the user types', async () => {
      const { user } = render(<Input onClear={vi.fn()} clearLabel="Temizle" placeholder="x" />);
      await user.type(screen.getByPlaceholderText('x'), 'abc');
      expect(screen.getByRole('button', { name: 'Temizle' })).toBeInTheDocument();
    });

    it('fires onClear and empties the input when clicked', async () => {
      const onClear = vi.fn();
      const { user } = render(
        <Input onClear={onClear} clearLabel="Temizle" placeholder="x" defaultValue="hello" />,
      );

      const input = screen.getByPlaceholderText('x') as HTMLInputElement;
      expect(input.value).toBe('hello');

      await user.click(screen.getByRole('button', { name: 'Temizle' }));

      expect(onClear).toHaveBeenCalledOnce();
      expect(input.value).toBe('');
    });

    it('hides the clear button when disabled', () => {
      render(
        <Input
          onClear={vi.fn()}
          clearLabel="Temizle"
          defaultValue="hello"
          disabled
          placeholder="x"
        />,
      );
      expect(screen.queryByRole('button', { name: 'Temizle' })).not.toBeInTheDocument();
    });

    it('hides the clear button when readOnly', () => {
      render(
        <Input
          onClear={vi.fn()}
          clearLabel="Temizle"
          defaultValue="hello"
          readOnly
          placeholder="x"
        />,
      );
      expect(screen.queryByRole('button', { name: 'Temizle' })).not.toBeInTheDocument();
    });
  });

  describe('onClear prop (controlled)', () => {
    it('renders the clear button when value is non-empty', () => {
      render(
        <Input
          value="abc"
          onChange={vi.fn()}
          onClear={vi.fn()}
          clearLabel="Temizle"
          placeholder="x"
        />,
      );
      expect(screen.getByRole('button', { name: 'Temizle' })).toBeInTheDocument();
    });

    it('hides the clear button when controlled value is empty', () => {
      render(
        <Input
          value=""
          onChange={vi.fn()}
          onClear={vi.fn()}
          clearLabel="Temizle"
          placeholder="x"
        />,
      );
      expect(screen.queryByRole('button', { name: 'Temizle' })).not.toBeInTheDocument();
    });

    it('fires onClear without mutating controlled value directly', async () => {
      const onClear = vi.fn();
      const onChange = vi.fn();
      const { user } = render(
        <Input
          value="abc"
          onChange={onChange}
          onClear={onClear}
          clearLabel="Temizle"
          placeholder="x"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Temizle' }));
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  describe('ref forwarding', () => {
    it('forwards ref to the underlying input element', () => {
      const ref = { current: null as HTMLInputElement | null };
      render(<Input ref={ref} placeholder="x" />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('forwards ref through the wrapper variant too', () => {
      const ref = { current: null as HTMLInputElement | null };
      render(<Input ref={ref} placeholder="x" leadingIcon={<svg data-testid="lead" />} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });
  });
});
