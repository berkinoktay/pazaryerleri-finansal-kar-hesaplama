import { describe, expect, it } from 'vitest';

import { Stepper, type StepperStep } from '@/components/patterns/stepper';

import { render, screen, within } from '../helpers/render';

const STEPS: StepperStep[] = [
  { id: 'details', label: 'Mağaza bilgileri', description: 'İsim ve pazaryeri' },
  { id: 'credentials', label: 'API anahtarları', description: 'Trendyol panelinden' },
  { id: 'verify', label: 'Bağlantıyı doğrula', description: 'Test çağrısı' },
  { id: 'sync', label: 'İlk senkron', description: 'Sipariş ve ürün' },
];

describe('<Stepper>', () => {
  describe('default state derivation', () => {
    it('marks indices < current as completed (check icon, no number)', () => {
      render(<Stepper steps={STEPS} current={2} aria-label="Mağaza bağlama" />);

      const list = screen.getByRole('list', { name: 'Mağaza bağlama' });
      const items = within(list).getAllByRole('listitem');
      // Steps 0 + 1 are completed → number 1/2 is hidden, only check icon renders.
      expect(within(items[0]).queryByText('1')).not.toBeInTheDocument();
      expect(within(items[1]).queryByText('2')).not.toBeInTheDocument();
    });

    it('marks the index === current with aria-current="step" and shows its number', () => {
      render(<Stepper steps={STEPS} current={2} aria-label="Mağaza bağlama" />);

      const list = screen.getByRole('list', { name: 'Mağaza bağlama' });
      const items = within(list).getAllByRole('listitem');
      // Only the current step carries aria-current.
      expect(items[0]).not.toHaveAttribute('aria-current');
      expect(items[1]).not.toHaveAttribute('aria-current');
      expect(items[2]).toHaveAttribute('aria-current', 'step');
      expect(items[3]).not.toHaveAttribute('aria-current');
      // Current step's indicator shows its 1-based number.
      expect(within(items[2]).getByText('3')).toBeInTheDocument();
    });

    it('marks indices > current as upcoming (number visible, no aria-current)', () => {
      render(<Stepper steps={STEPS} current={2} aria-label="Mağaza bağlama" />);

      const list = screen.getByRole('list', { name: 'Mağaza bağlama' });
      const items = within(list).getAllByRole('listitem');
      expect(within(items[3]).getByText('4')).toBeInTheDocument();
      expect(items[3]).not.toHaveAttribute('aria-current');
    });

    it('after the last step (current === steps.length) renders all steps as completed', () => {
      render(<Stepper steps={STEPS} current={STEPS.length} aria-label="Tamamlandı" />);

      const list = screen.getByRole('list', { name: 'Tamamlandı' });
      const items = within(list).getAllByRole('listitem');
      // No aria-current anywhere — there's no active step left.
      for (const item of items) {
        expect(item).not.toHaveAttribute('aria-current');
      }
    });
  });

  describe('per-step state override', () => {
    it('renders an explicit "error" step regardless of cursor position', () => {
      const stepsWithError = STEPS.map((step, index) =>
        index === 1 ? ({ ...step, state: 'error' } as const) : step,
      );
      render(<Stepper steps={stepsWithError} current={2} aria-label="Hatalı" />);

      const list = screen.getByRole('list', { name: 'Hatalı' });
      const items = within(list).getAllByRole('listitem');
      // The errored step's label gets the destructive font-medium class — assert
      // via the rendered text (visible, regardless of number/check glyph).
      expect(within(items[1]).getByText('API anahtarları')).toBeInTheDocument();
      // Cursor stays on step 3 even though the prior step failed.
      expect(items[2]).toHaveAttribute('aria-current', 'step');
    });
  });

  describe('labels and descriptions', () => {
    it('renders both label and description per step by default', () => {
      render(<Stepper steps={STEPS} current={1} aria-label="Mağaza bağlama" />);

      expect(screen.getByText('Mağaza bilgileri')).toBeInTheDocument();
      expect(screen.getByText('İsim ve pazaryeri')).toBeInTheDocument();
      expect(screen.getByText('API anahtarları')).toBeInTheDocument();
      expect(screen.getByText('Trendyol panelinden')).toBeInTheDocument();
    });

    it('hides labels and descriptions when hideLabels is true', () => {
      render(<Stepper steps={STEPS} current={1} hideLabels aria-label="Kompakt" />);

      expect(screen.queryByText('Mağaza bilgileri')).not.toBeInTheDocument();
      expect(screen.queryByText('İsim ve pazaryeri')).not.toBeInTheDocument();
      // Indicators (and their numbers) are still rendered.
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('orientation', () => {
    it('renders vertical orientation with the same step count and active marker', () => {
      render(<Stepper steps={STEPS} current={1} orientation="vertical" aria-label="Dikey akış" />);

      const list = screen.getByRole('list', { name: 'Dikey akış' });
      const items = within(list).getAllByRole('listitem');
      expect(items).toHaveLength(STEPS.length);
      expect(items[1]).toHaveAttribute('aria-current', 'step');
    });
  });

  describe('icon override', () => {
    it('renders a custom icon when provided on a step', () => {
      const stepsWithIcon: StepperStep[] = STEPS.map((step, index) =>
        index === 0 ? { ...step, icon: <svg data-testid="custom-glyph" aria-hidden /> } : step,
      );
      render(<Stepper steps={stepsWithIcon} current={2} aria-label="Custom" />);

      expect(screen.getByTestId('custom-glyph')).toBeInTheDocument();
    });
  });
});
