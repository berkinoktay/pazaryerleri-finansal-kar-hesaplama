'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
} from 'react-hook-form';

import { Label, type LabelProps } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * React Hook Form + Zod + shadcn bridge.
 *
 * The purpose of this wrapper: keep every form across the product visually
 * and behaviourally identical. Fields auto-wire their label, description,
 * and error message through `aria-describedby`, so accessibility never
 * diverges from one screen to the next.
 *
 * Compose `Form` (FormProvider) → `FormField` (Controller) → `FormItem`
 * (id provider) → `FormLabel` + `FormControl` + `FormDescription` +
 * `FormMessage`. Pair with the global VALIDATION_ERROR pipeline — when
 * the backend rejects a payload, the form's useEffect calls
 * `form.setError` per `error.problem.errors[]` so inline messages
 * appear in Turkish via i18n (see apps/web/CLAUDE.md "Forms +
 * VALIDATION_ERROR propagation").
 *
 * @useWhen building any react-hook-form + zod form so labels, descriptions, and errors auto-wire via aria-describedby across the product
 */

export const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
}

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  TTransformedValues = TFieldValues,
>({ ...props }: ControllerProps<TFieldValues, TName, TTransformedValues>): React.ReactElement {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

interface FormItemContextValue {
  id: string;
  /** True once a `<FormDescription>` has mounted in this item — drives the conditional aria-describedby. */
  hasDescription: boolean;
  setHasDescription: (value: boolean) => void;
}

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

export function useFormField(): {
  id: string;
  name: string;
  formItemId: string;
  formDescriptionId: string;
  formMessageId: string;
  hasDescription: boolean;
  setHasDescription: (value: boolean) => void;
  invalid: boolean;
  isDirty: boolean;
  isTouched: boolean;
  error?: { message?: string };
} {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error('useFormField must be used inside <FormField>');
  }

  const { id, hasDescription, setHasDescription } = itemContext;
  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    hasDescription,
    setHasDescription,
    ...fieldState,
  };
}

export interface FormItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Field layout. `column` (default) stacks label → control → message; `row`
   * lays the label and control side-by-side (the inline Switch/Checkbox
   * settings row), replacing per-call `className` flex overrides.
   */
  direction?: 'column' | 'row';
}

export const FormItem = React.forwardRef<HTMLDivElement, FormItemProps>(
  ({ className, direction = 'column', ...props }, ref) => {
    const id = React.useId();
    const [hasDescription, setHasDescription] = React.useState(false);
    // Surface the field's error as data-invalid so wrappers can tint the whole
    // row on error (the Input/Textarea primitives already read data-[invalid]).
    const fieldContext = React.useContext(FormFieldContext);
    const { getFieldState, formState } = useFormContext();
    const error = fieldContext.name ? getFieldState(fieldContext.name, formState).error : undefined;
    return (
      <FormItemContext.Provider value={{ id, hasDescription, setHasDescription }}>
        <div
          ref={ref}
          data-invalid={error ? 'true' : undefined}
          className={cn(
            'flex',
            direction === 'row'
              ? 'gap-sm flex-row items-center justify-between'
              : 'gap-3xs flex-col',
            className,
          )}
          {...props}
        />
      </FormItemContext.Provider>
    );
  },
);
FormItem.displayName = 'FormItem';

export const FormLabel = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, ...props }, ref) => {
    const { error, formItemId } = useFormField();
    return (
      <Label
        ref={ref}
        className={cn(error && 'text-destructive', className)}
        htmlFor={formItemId}
        {...props}
      />
    );
  },
);
FormLabel.displayName = 'FormLabel';

export const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId, hasDescription } = useFormField();
  // Only reference ids that are actually in the DOM — a description id is
  // included only when a <FormDescription> is mounted, a message id only on
  // error. An aria-describedby pointing at a missing element is a dangling
  // IDREF (axe/NVDA flag it).
  const describedBy =
    [hasDescription ? formDescriptionId : null, error ? formMessageId : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={describedBy}
      aria-invalid={!!error || undefined}
      {...props}
    />
  );
});
FormControl.displayName = 'FormControl';

export const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const { formDescriptionId, setHasDescription } = useFormField();
  // Register/unregister so FormControl can include this id in aria-describedby
  // only while the description is actually rendered.
  React.useEffect(() => {
    setHasDescription(true);
    return () => setHasDescription(false);
  }, [setHasDescription]);
  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn('text-2xs text-muted-foreground', className)}
      {...props}
    />
  );
});
FormDescription.displayName = 'FormDescription';

export interface FormMessageProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /**
   * Map the raw error message (typically a backend/zod code) to localized copy
   * before rendering. Lets callers translate without forking a raw `<p>` —
   * keeps the id / role="alert" / animation contract on every form error.
   *
   * @example
   * <FormMessage render={(code) => tErr(knownCodeFor(code))} />
   */
  render?: (message: string) => React.ReactNode;
}

export const FormMessage = React.forwardRef<HTMLParagraphElement, FormMessageProps>(
  ({ className, children, render, ...props }, ref) => {
    const { error, formMessageId } = useFormField();
    const rawMessage = error ? String(error.message ?? '') : undefined;
    const body = rawMessage !== undefined ? (render ? render(rawMessage) : rawMessage) : children;
    if (!body) return null;
    return (
      <p
        ref={ref}
        id={formMessageId}
        // role="alert" announces the message when it mounts (error appears);
        // aria-atomic reads the whole line. It also auto-wires to the field via
        // FormControl's aria-describedby for on-focus context.
        role="alert"
        aria-atomic="true"
        className={cn(
          'text-2xs text-destructive font-medium',
          'animate-in fade-in-0 slide-in-from-top-1 duration-fast ease-out-quart',
          className,
        )}
        {...props}
      >
        {body}
      </p>
    );
  },
);
FormMessage.displayName = 'FormMessage';
