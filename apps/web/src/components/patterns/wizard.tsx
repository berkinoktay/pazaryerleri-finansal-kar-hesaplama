'use client';

import { ArrowLeft01Icon, ArrowRight01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Stepper, type StepperStep } from '@/components/patterns/stepper';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Multi-step flow shell — Stepper at the top, current step's content
 * pane in the middle, Back / Next navigation in the footer. Generalizes
 * the single-step `connect-store-flow.tsx` so the same shell hosts
 * store-connection v2, settlement-import wizard, future onboarding.
 *
 * Controlled cursor — caller owns `current` and `onCurrentChange`,
 * which keeps URL/search-param-driven wizards composable (e.g. wizard
 * state survives reload via `?step=2`). Per-step `onAdvance` is
 * async-friendly: throw / reject to keep the user on the current step
 * (e.g. "verify API key" failed). Per-step `canAdvance` is the
 * synchronous predicate that disables the Next button (typically wired
 * to the step form's `formState.isValid`).
 *
 * The footer is a slot — pass a custom `footer` to override the
 * default Back+Next pair entirely (use this for a step that needs an
 * inline "Skip" link or a multi-action row).
 *
 * @useWhen building a multi-step flow with a visible progress
 * indicator and per-step content (use Tabs for non-sequential sibling
 * sections, raw form for one-shot single-step entry)
 */

export interface WizardStep {
  /** Stable identity for React keys + Stepper. */
  id: string;
  /** Bold label rendered in the Stepper. */
  label: string;
  /** Optional sub-text under the label in the Stepper. */
  description?: string;
  /** The body rendered in the content pane while this step is active. */
  content: React.ReactNode;
  /**
   * Synchronous predicate — when `false`, the Next button is disabled.
   * Wire to the step form's validation state. Defaults to `true`.
   */
  canAdvance?: boolean;
  /** Per-step override for the Next button label (e.g. "Doğrula ve devam et"). */
  nextLabel?: string;
  /**
   * Per-step async handler called before advancing. Throw / reject to
   * stay on the step (the wizard renders the spinner during the call
   * and surfaces nothing about the failure — caller is responsible for
   * its own error UI, typically inline in the step content).
   */
  onAdvance?: () => void | Promise<void>;
  /**
   * Override the Stepper indicator state for this step. Use `'error'`
   * to keep a failed step visible after the user has moved past it.
   */
  state?: StepperStep['state'];
}

export interface WizardProps {
  /** Ordered list of steps. */
  steps: WizardStep[];
  /** 0-indexed cursor that drives both the Stepper and which content renders. */
  current: number;
  /** Fires when the user advances or goes back. */
  onCurrentChange: (next: number) => void;
  /**
   * Fires when the user advances past the last step's Next button.
   * Same async contract as a step's `onAdvance` — reject to keep the
   * wizard mounted (the caller renders inline error feedback).
   */
  onComplete?: () => void | Promise<void>;
  /**
   * Override the back-button behavior. Defaults to `current - 1`
   * (clamped to 0). Pass when leaving the wizard from step 0 needs
   * a "discard draft?" confirmation.
   */
  onBack?: () => void;
  /** Localized "Back" CTA. */
  backLabel?: string;
  /** Localized "Next" CTA — overridden per-step by `step.nextLabel`. */
  nextLabel?: string;
  /** Localized "Complete" CTA on the final step. */
  completeLabel?: string;
  /** Localized aria-label for the Stepper region. */
  stepperAriaLabel?: string;
  /**
   * Replace the default Back+Next footer entirely. Use for a step
   * that needs a custom action row — the wizard still tracks `current`
   * but you own the navigation buttons.
   */
  footer?: React.ReactNode;
  /** Hide the back button on step 0 instead of disabling it. Defaults to `true`. */
  hideBackOnFirstStep?: boolean;
  className?: string;
}

export function Wizard({
  steps,
  current,
  onCurrentChange,
  onComplete,
  onBack,
  backLabel = 'Geri',
  nextLabel = 'Devam et',
  completeLabel = 'Tamamla',
  stepperAriaLabel,
  footer,
  hideBackOnFirstStep = true,
  className,
}: WizardProps): React.ReactElement {
  const [isAdvancing, setIsAdvancing] = React.useState(false);

  const stepperSteps = React.useMemo<StepperStep[]>(
    () =>
      steps.map(({ content, canAdvance, nextLabel: _n, onAdvance, ...rest }) => {
        // strip wizard-only fields before handing the step list to Stepper —
        // Stepper validates against StepperStep keys
        void content;
        void canAdvance;
        void _n;
        void onAdvance;
        return rest;
      }),
    [steps],
  );

  const activeStep = steps[current];
  const isLastStep = current === steps.length - 1;
  const canAdvance = activeStep?.canAdvance ?? true;
  const effectiveNextLabel = activeStep?.nextLabel ?? (isLastStep ? completeLabel : nextLabel);

  const handleBack = (): void => {
    if (onBack !== undefined) {
      onBack();
      return;
    }
    if (current === 0) return;
    onCurrentChange(current - 1);
  };

  const handleNext = async (): Promise<void> => {
    if (activeStep === undefined) return;
    if (!canAdvance || isAdvancing) return;

    if (activeStep.onAdvance !== undefined) {
      try {
        setIsAdvancing(true);
        await activeStep.onAdvance();
      } catch {
        // Caller renders its own error UI (inline in step content).
        return;
      } finally {
        setIsAdvancing(false);
      }
    }

    if (isLastStep) {
      if (onComplete !== undefined) {
        try {
          setIsAdvancing(true);
          await onComplete();
        } catch {
          return;
        } finally {
          setIsAdvancing(false);
        }
      }
      return;
    }

    onCurrentChange(current + 1);
  };

  const showBack = !(hideBackOnFirstStep && current === 0);

  return (
    <div className={cn('gap-lg flex flex-col', className)}>
      <Stepper steps={stepperSteps} current={current} aria-label={stepperAriaLabel} />

      <div className="gap-md flex flex-col">
        {activeStep !== undefined ? activeStep.content : null}
      </div>

      {footer ?? (
        <div className="gap-sm flex items-center justify-between">
          {showBack ? (
            <Button type="button" variant="outline" onClick={handleBack} disabled={isAdvancing}>
              <ArrowLeft01Icon className="size-icon-sm" aria-hidden />
              {backLabel}
            </Button>
          ) : (
            <span aria-hidden />
          )}
          <Button
            type="button"
            variant="default"
            onClick={() => {
              void handleNext();
            }}
            disabled={!canAdvance || isAdvancing}
          >
            {isAdvancing ? <Spinner /> : null}
            {effectiveNextLabel}
            {!isAdvancing && !isLastStep ? (
              <ArrowRight01Icon className="size-icon-sm" aria-hidden />
            ) : null}
          </Button>
        </div>
      )}
    </div>
  );
}
