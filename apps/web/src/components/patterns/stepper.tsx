'use client';

import { Cancel01Icon, Tick02Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Multi-step indicator. Renders a horizontal or vertical track of
 * numbered indicators connected by lines, with per-step state
 * (`completed`, `current`, `upcoming`, `error`) driving both the
 * indicator visual (filled / outlined / muted) and the connector
 * color (so a green line trails completed steps).
 *
 * The Wizard organism (not built yet) will compose this with a
 * step-content pane and per-step form state. For one-shot flows
 * use the raw form pattern; reach for Stepper when the user benefits
 * from seeing where they are in a multi-stage process — store
 * connection, settlement upload, onboarding.
 *
 * State derivation: by default, indices < `current` are `completed`,
 * `current` itself is `current`, and indices > `current` are
 * `upcoming`. Per-step `state` overrides this — pass `'error'` on
 * a step where validation failed so it stays visible after the user
 * has already moved past it.
 *
 * @useWhen showing progress through a discrete multi-step flow where users benefit from a per-step status (use Progress for a single continuous bar, Tabs for non-sequential navigation between sibling sections)
 */

export type StepperStepState = 'completed' | 'current' | 'upcoming' | 'error';

export interface StepperStep {
  /** Stable identity for React keys. */
  id: string;
  /** Bold label rendered next to / under the indicator. */
  label: string;
  /** Optional secondary line under the label (sub-text, hint). */
  description?: string;
  /**
   * Override the derived state. Useful for `'error'` (invalid step the
   * user has moved past) or to force a step into `'completed'`
   * regardless of the cursor position.
   */
  state?: StepperStepState;
  /**
   * Override the indicator glyph. Defaults to the 1-based step number
   * for `current` / `upcoming`, the check icon for `completed`, and
   * the cancel icon for `error`.
   */
  icon?: React.ReactNode;
}

export interface StepperProps {
  /** Ordered list of steps. */
  steps: StepperStep[];
  /** 0-indexed cursor that drives default state derivation. */
  current: number;
  /** Default `'horizontal'`. */
  orientation?: 'horizontal' | 'vertical';
  /** Hide labels — only indicators and connectors render. Useful in
   * narrow rails or compact summaries where the title lives elsewhere. */
  hideLabels?: boolean;
  /** Translated `aria-label` for the surrounding `<ol>` so screen
   * readers announce the region (e.g. "Mağaza bağlama adımları"). */
  'aria-label'?: string;
  className?: string;
}

function deriveState(index: number, current: number): StepperStepState {
  if (index < current) return 'completed';
  if (index === current) return 'current';
  return 'upcoming';
}

const INDICATOR_TONE: Record<StepperStepState, string> = {
  completed: 'border-primary bg-primary text-primary-foreground',
  current: 'border-primary bg-background text-primary',
  upcoming: 'border-border bg-background text-muted-foreground',
  error: 'border-destructive bg-destructive text-destructive-foreground',
};

const LABEL_TONE: Record<StepperStepState, string> = {
  completed: 'text-foreground',
  current: 'text-foreground font-medium',
  upcoming: 'text-muted-foreground',
  error: 'text-destructive font-medium',
};

const CONNECTOR_TONE: Record<StepperStepState, string> = {
  completed: 'bg-primary',
  current: 'bg-border',
  upcoming: 'bg-border',
  error: 'bg-border',
};

interface StepIndicatorProps {
  state: StepperStepState;
  index: number;
  icon?: React.ReactNode;
}

function StepIndicator({ state, index, icon }: StepIndicatorProps): React.ReactElement {
  const glyph =
    icon ??
    (state === 'completed' ? (
      <Tick02Icon className="size-icon-sm" aria-hidden />
    ) : state === 'error' ? (
      <Cancel01Icon className="size-icon-sm" aria-hidden />
    ) : (
      <span aria-hidden className="text-2xs font-semibold tabular-nums">
        {index + 1}
      </span>
    ));

  return (
    <span
      className={cn(
        'duration-fast flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        INDICATOR_TONE[state],
      )}
    >
      {glyph}
    </span>
  );
}

export function Stepper({
  steps,
  current,
  orientation = 'horizontal',
  hideLabels = false,
  'aria-label': ariaLabel,
  className,
}: StepperProps): React.ReactElement {
  if (orientation === 'vertical') {
    return (
      <ol aria-label={ariaLabel} className={cn('gap-3xs flex flex-col', className)}>
        {steps.map((step, index) => {
          const state = step.state ?? deriveState(index, current);
          const isLast = index === steps.length - 1;
          return (
            <li
              key={step.id}
              aria-current={state === 'current' ? 'step' : undefined}
              className="gap-sm flex"
            >
              <div className="gap-3xs flex flex-col items-center">
                <StepIndicator state={state} index={index} icon={step.icon} />
                {!isLast ? (
                  <span aria-hidden className={cn('w-px flex-1', CONNECTOR_TONE[state])} />
                ) : null}
              </div>
              {!hideLabels ? (
                <div className={cn('gap-3xs flex flex-col', !isLast && 'pb-md')}>
                  <span className={cn('text-sm leading-tight', LABEL_TONE[state])}>
                    {step.label}
                  </span>
                  {step.description !== undefined ? (
                    <span className="text-2xs text-muted-foreground leading-snug">
                      {step.description}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol aria-label={ariaLabel} className={cn('flex w-full', className)}>
      {steps.map((step, index) => {
        const state = step.state ?? deriveState(index, current);
        const isLast = index === steps.length - 1;
        return (
          <li
            key={step.id}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn('gap-3xs flex flex-col', !isLast && 'flex-1')}
          >
            <div className="gap-xs flex items-center">
              <StepIndicator state={state} index={index} icon={step.icon} />
              {!isLast ? (
                <span aria-hidden className={cn('h-px flex-1', CONNECTOR_TONE[state])} />
              ) : null}
            </div>
            {!hideLabels ? (
              <div className="gap-3xs flex flex-col">
                <span className={cn('text-sm leading-tight', LABEL_TONE[state])}>{step.label}</span>
                {step.description !== undefined ? (
                  <span className="text-2xs text-muted-foreground leading-snug">
                    {step.description}
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
