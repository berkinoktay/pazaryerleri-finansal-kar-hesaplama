'use client';

import * as React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Interactive prop-simulation surface — the showcase's core demo unit.
 *
 * A typed `controls` config drives a control strip (enum → segmented
 * ToggleGroup, long enum → Select, boolean → Switch, free text → Input). The
 * current control state is handed to `render(values)`, which returns the live
 * component. The control strip IS the interactive props documentation: instead
 * of rendering "every variant" in a static grid, the reader flips a prop and
 * watches the component respond. This replaces the repetitive static-grid
 * Previews that bloated the old showcase (e.g. four Button previews → one
 * Playground).
 *
 * Type-safe via `const`-generic control builders (see `control`): `v.variant`
 * narrows to the literal option union and `v.loading` is `boolean`, so call
 * sites pass them straight to the component with no `as`.
 *
 * SSR-safe: controls are client state seeded deterministically from each
 * control's `default` — no Date/theme reads, no hydration drift.
 *
 * @useWhen documenting a component whose prop/variant surface is best shown by letting the reader flip props live (use Preview for a fixed behavior demo)
 */

// NOTE: option types stay in COVARIANT positions only (`options`, `default`) so
// a `SegmentControl<'sm'|'md'|'lg'>` is assignable to `SegmentControl<string>`
// — that assignability is what lets `Playground<M>` infer `M` as the precise
// literal shape and hand `render` the narrow per-prop unions. A contravariant
// field (e.g. `optionLabel: (v: T) => string`) would break it; option display
// is just the raw value.
type SegmentControl<T extends string> = {
  kind: 'segment';
  options: readonly T[];
  default: T;
  label?: string;
};
type SelectControl<T extends string> = {
  kind: 'select';
  options: readonly T[];
  default: T;
  label?: string;
};
type SwitchControl = { kind: 'switch'; default: boolean; label?: string };
type TextControl = { kind: 'text'; default: string; label?: string; placeholder?: string };

type Control = SegmentControl<string> | SelectControl<string> | SwitchControl | TextControl;

type ControlValue<C extends Control> = C extends SwitchControl
  ? boolean
  : C extends TextControl
    ? string
    : C extends SegmentControl<infer T>
      ? T
      : C extends SelectControl<infer S>
        ? S
        : never;

type ControlValues<M extends Record<string, Control>> = {
  [K in keyof M]: ControlValue<M[K]>;
};

/**
 * Control builders. `const T` captures the option literals without `as const`
 * at the call site; `NoInfer` keeps `default` from widening the option union.
 */
export const control = {
  segment: <const T extends string>(
    options: readonly T[],
    defaultValue: NoInfer<T>,
    label?: string,
  ): SegmentControl<T> => ({ kind: 'segment', options, default: defaultValue, label }),
  select: <const T extends string>(
    options: readonly T[],
    defaultValue: NoInfer<T>,
    label?: string,
  ): SelectControl<T> => ({ kind: 'select', options, default: defaultValue, label }),
  bool: (defaultValue = false, label?: string): SwitchControl => ({
    kind: 'switch',
    default: defaultValue,
    label,
  }),
  text: (defaultValue = '', label?: string, placeholder?: string): TextControl => ({
    kind: 'text',
    default: defaultValue,
    label,
    placeholder,
  }),
};

type ControlPrimitive = string | boolean;

export interface PlaygroundProps<M extends Record<string, Control>> {
  /** Prop → control definition (built with `control.*`). The keys become the prop names passed to `render`. */
  controls: M;
  /** Receives the live control values (typed) and returns the component instance to demo. */
  render: (values: ControlValues<M>) => React.ReactNode;
  /** Optional heading above the stage (mirrors Preview). */
  title?: string;
  description?: string;
  /** Put the live demo on a dark surface to assess border/contrast. */
  onDark?: boolean;
  /** Control strip placement relative to the stage. */
  controlsPosition?: 'bottom' | 'right';
  className?: string;
}

export function Playground<M extends Record<string, Control>>({
  controls,
  render,
  title,
  description,
  onDark = false,
  controlsPosition = 'bottom',
  className,
}: PlaygroundProps<M>): React.ReactElement {
  const [values, setValues] = React.useState<Record<string, ControlPrimitive>>(() => {
    const initial: Record<string, ControlPrimitive> = {};
    for (const key of Object.keys(controls)) {
      initial[key] = controls[key].default;
    }
    return initial;
  });

  const setValue = (key: string, value: ControlPrimitive): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  // Sound bridge: `values` is only ever seeded from each control's typed
  // `default` and updated from that control's own widget, so it matches the
  // mapped value shape by construction. TS cannot prove a generic record equals
  // a mapped type, so this single assertion stands in for that guarantee.
  const typedValues = values as ControlValues<M>;

  const stage = (
    <div
      className={cn(
        'border-border p-lg gap-md flex min-h-32 flex-1 flex-wrap items-center rounded-lg border',
        onDark ? 'bg-foreground text-background' : 'bg-background',
      )}
    >
      {render(typedValues)}
    </div>
  );

  const strip = (
    <div
      className={cn(
        'border-border bg-surface-subtle p-md gap-md flex flex-wrap rounded-lg border',
        controlsPosition === 'right' && 'lg:w-64 lg:flex-col lg:flex-nowrap',
      )}
    >
      {Object.keys(controls).map((key) => (
        <ControlField
          key={key}
          name={key}
          control={controls[key]}
          value={values[key]}
          onChange={(next) => setValue(key, next)}
        />
      ))}
    </div>
  );

  return (
    <section className={cn('gap-sm flex flex-col', className)}>
      {title !== undefined ? (
        <div className="gap-3xs flex flex-col">
          <h3 className="text-md text-foreground font-semibold">{title}</h3>
          {description !== undefined ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          'gap-md flex flex-col',
          controlsPosition === 'right' && 'lg:flex-row lg:items-stretch',
        )}
      >
        {stage}
        {strip}
      </div>
    </section>
  );
}

interface ControlFieldProps {
  name: string;
  control: Control;
  value: ControlPrimitive;
  onChange: (value: ControlPrimitive) => void;
}

function ControlField({ name, control, value, onChange }: ControlFieldProps): React.ReactElement {
  const label = control.label ?? name;
  return (
    <div className="gap-3xs flex flex-col">
      <span className="text-2xs text-muted-foreground font-mono">{label}</span>
      <ControlWidget control={control} label={label} value={value} onChange={onChange} />
    </div>
  );
}

interface ControlWidgetProps {
  control: Control;
  label: string;
  value: ControlPrimitive;
  onChange: (value: ControlPrimitive) => void;
}

function ControlWidget({
  control,
  label,
  value,
  onChange,
}: ControlWidgetProps): React.ReactElement {
  switch (control.kind) {
    case 'segment':
      return (
        <ToggleGroup
          type="single"
          size="sm"
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => {
            if (next !== '') onChange(next);
          }}
          aria-label={label}
        >
          {control.options.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      );
    case 'select':
      return (
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger size="sm" className="min-w-40" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {control.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'switch':
      return (
        <Switch
          checked={value === true}
          onCheckedChange={(next) => onChange(next)}
          aria-label={label}
        />
      );
    case 'text':
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={control.placeholder}
          aria-label={label}
          className="min-w-40"
        />
      );
    default: {
      const exhaustive: never = control;
      throw new Error(`Unhandled control kind: ${String(exhaustive)}`);
    }
  }
}
