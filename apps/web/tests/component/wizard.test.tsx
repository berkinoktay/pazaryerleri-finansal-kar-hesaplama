import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Wizard, type WizardStep } from '@/components/patterns/wizard';

import { render, screen, waitFor, within } from '../helpers/render';

function makeSteps(opts: Partial<WizardStep>[] = []): WizardStep[] {
  const defaults: WizardStep[] = [
    { id: 'a', label: 'Mağaza bilgileri', content: <div>STEP_A_CONTENT</div> },
    { id: 'b', label: 'API anahtarları', content: <div>STEP_B_CONTENT</div> },
    { id: 'c', label: 'Doğrula', content: <div>STEP_C_CONTENT</div> },
  ];
  return defaults.map((step, index) => ({ ...step, ...(opts[index] ?? {}) }));
}

interface HarnessProps {
  steps?: WizardStep[];
  initialCurrent?: number;
  onCompleteSpy?: () => void | Promise<void>;
  onCurrentChangeSpy?: (next: number) => void;
  hideBackOnFirstStep?: boolean;
}

function Harness({
  steps = makeSteps(),
  initialCurrent = 0,
  onCompleteSpy,
  onCurrentChangeSpy,
  hideBackOnFirstStep,
}: HarnessProps): React.ReactElement {
  const [current, setCurrent] = React.useState(initialCurrent);
  return (
    <Wizard
      steps={steps}
      current={current}
      onCurrentChange={(next) => {
        setCurrent(next);
        onCurrentChangeSpy?.(next);
      }}
      onComplete={onCompleteSpy}
      stepperAriaLabel="Akış"
      hideBackOnFirstStep={hideBackOnFirstStep}
    />
  );
}

describe('<Wizard>', () => {
  describe('rendering', () => {
    it('renders the Stepper with all steps and the active step content', () => {
      render(<Harness initialCurrent={1} />);

      expect(screen.getByRole('list', { name: 'Akış' })).toBeInTheDocument();
      // Active step content is in the DOM; non-active steps are not rendered.
      expect(screen.getByText('STEP_B_CONTENT')).toBeInTheDocument();
      expect(screen.queryByText('STEP_A_CONTENT')).not.toBeInTheDocument();
      expect(screen.queryByText('STEP_C_CONTENT')).not.toBeInTheDocument();
    });

    it('marks the current step on the Stepper with aria-current="step"', () => {
      render(<Harness initialCurrent={1} />);
      const list = screen.getByRole('list', { name: 'Akış' });
      const items = within(list).getAllByRole('listitem');
      expect(items[0]).not.toHaveAttribute('aria-current');
      expect(items[1]).toHaveAttribute('aria-current', 'step');
      expect(items[2]).not.toHaveAttribute('aria-current');
    });
  });

  describe('navigation footer', () => {
    it('hides the Back button on the first step by default', () => {
      render(<Harness initialCurrent={0} />);
      expect(screen.queryByRole('button', { name: /Geri/ })).not.toBeInTheDocument();
    });

    it('renders Back when hideBackOnFirstStep=false', () => {
      render(<Harness initialCurrent={0} hideBackOnFirstStep={false} />);
      expect(screen.getByRole('button', { name: /Geri/ })).toBeInTheDocument();
    });

    it('shows the Next button by default and a custom per-step nextLabel when provided', () => {
      const steps = makeSteps([{ nextLabel: 'Doğrula ve devam et' }, {}, {}]);
      render(<Harness steps={steps} initialCurrent={0} />);
      expect(screen.getByRole('button', { name: 'Doğrula ve devam et' })).toBeInTheDocument();
    });

    it('renders the localized completeLabel on the last step', () => {
      const steps = makeSteps();
      render(<Harness steps={steps} initialCurrent={2} />);
      expect(screen.getByRole('button', { name: 'Tamamla' })).toBeInTheDocument();
    });
  });

  describe('canAdvance', () => {
    it('disables Next when the current step has canAdvance=false', () => {
      const steps = makeSteps([{ canAdvance: false }, {}, {}]);
      render(<Harness steps={steps} initialCurrent={0} />);
      expect(screen.getByRole('button', { name: /Devam et/ })).toBeDisabled();
    });

    it('enables Next when the current step has canAdvance=true (or omitted)', () => {
      render(<Harness initialCurrent={0} />);
      expect(screen.getByRole('button', { name: /Devam et/ })).toBeEnabled();
    });
  });

  describe('cursor advancement', () => {
    it('clicking Next fires onCurrentChange with current+1', async () => {
      const onCurrentChangeSpy = vi.fn<(n: number) => void>();
      const { user } = render(
        <Harness initialCurrent={0} onCurrentChangeSpy={onCurrentChangeSpy} />,
      );

      await user.click(screen.getByRole('button', { name: /Devam et/ }));

      expect(onCurrentChangeSpy).toHaveBeenLastCalledWith(1);
      expect(screen.getByText('STEP_B_CONTENT')).toBeInTheDocument();
    });

    it('clicking Back fires onCurrentChange with current-1', async () => {
      const onCurrentChangeSpy = vi.fn<(n: number) => void>();
      const { user } = render(
        <Harness initialCurrent={2} onCurrentChangeSpy={onCurrentChangeSpy} />,
      );

      await user.click(screen.getByRole('button', { name: /Geri/ }));

      expect(onCurrentChangeSpy).toHaveBeenLastCalledWith(1);
    });
  });

  describe('per-step onAdvance', () => {
    it('awaits onAdvance before advancing the cursor', async () => {
      let resolve: (() => void) | undefined;
      const onAdvance = vi.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          }),
      );
      const onCurrentChangeSpy = vi.fn<(n: number) => void>();
      const steps = makeSteps([{ onAdvance }, {}, {}]);
      const { user } = render(<Harness steps={steps} onCurrentChangeSpy={onCurrentChangeSpy} />);

      await user.click(screen.getByRole('button', { name: /Devam et/ }));
      // Cursor hasn't moved yet — the promise is still pending.
      expect(onCurrentChangeSpy).not.toHaveBeenCalled();
      expect(onAdvance).toHaveBeenCalledTimes(1);

      resolve?.();
      await waitFor(() => {
        expect(onCurrentChangeSpy).toHaveBeenCalledWith(1);
      });
    });

    it('keeps the user on the current step when onAdvance rejects', async () => {
      const onAdvance = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('verify failed'));
      const onCurrentChangeSpy = vi.fn<(n: number) => void>();
      const steps = makeSteps([{ onAdvance }, {}, {}]);
      const { user } = render(<Harness steps={steps} onCurrentChangeSpy={onCurrentChangeSpy} />);

      await user.click(screen.getByRole('button', { name: /Devam et/ }));

      await waitFor(() => {
        expect(onAdvance).toHaveBeenCalledTimes(1);
      });
      expect(onCurrentChangeSpy).not.toHaveBeenCalled();
      // Step A content is still visible.
      expect(screen.getByText('STEP_A_CONTENT')).toBeInTheDocument();
    });
  });

  describe('onComplete', () => {
    it('fires onComplete on Next from the last step instead of advancing', async () => {
      const onCompleteSpy = vi.fn<() => void>();
      const onCurrentChangeSpy = vi.fn<(n: number) => void>();
      const { user } = render(
        <Harness
          initialCurrent={2}
          onCompleteSpy={onCompleteSpy}
          onCurrentChangeSpy={onCurrentChangeSpy}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Tamamla' }));

      expect(onCompleteSpy).toHaveBeenCalledTimes(1);
      // Cursor doesn't advance past the last step.
      expect(onCurrentChangeSpy).not.toHaveBeenCalled();
    });
  });
});
