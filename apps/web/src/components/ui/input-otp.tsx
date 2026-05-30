'use client';

import { OTPInput, OTPInputContext } from 'input-otp';
import { MinusSignIcon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * One-time-password / verification-code input split into discrete
 * character slots. Tabular numerics, auto-advance focus, and paste
 * support come from the underlying `input-otp` library. Use the
 * `InputOTPSeparator` between slot groups to chunk long codes (e.g.
 * `XXX-XXX` for a 6-digit code) for easier visual reading.
 *
 * Pass `invalid` to flag a rejected code: the container shakes
 * (`animate-field-shake`, matching Input/Select) and the prop is forwarded
 * to every `InputOTPSlot` so each slot paints a destructive border. Pass
 * `valid` after a successful verification for a success-tinted border.
 *
 * @useWhen rendering a one-time-password or verification-code field split into per-character slots
 */
// A `type` intersection, not `interface extends`: OTPInput's props are a UNION
// (input-otp's render-prop vs children-prop forms), and an interface can only
// extend an object with statically-known members — intersecting distributes
// invalid/valid across both union branches.
export type InputOTPProps = React.ComponentPropsWithoutRef<typeof OTPInput> & {
  /** Flags a rejected code — shakes the container and tints every slot border destructive. */
  invalid?: boolean;
  /** Flags an accepted code — tints every slot border success. Mutually exclusive with `invalid`. */
  valid?: boolean;
};

/**
 * Shared via context so a single `invalid` / `valid` on `InputOTP` reaches
 * every `InputOTPSlot` without the consumer threading the prop onto each slot.
 */
const InputOTPStateContext = React.createContext<{ invalid?: boolean; valid?: boolean }>({});

export const InputOTP = React.forwardRef<React.ElementRef<typeof OTPInput>, InputOTPProps>(
  ({ className, containerClassName, invalid, valid, ...props }, ref) => (
    <InputOTPStateContext.Provider value={{ invalid, valid }}>
      <OTPInput
        ref={ref}
        // `input-otp` spreads the rest onto the hidden input, not the
        // container div — so the container shake is applied to
        // `containerClassName` directly (mirrors Input's
        // `aria-invalid:animate-field-shake`). `aria-invalid` still lands on
        // the input for assistive tech.
        aria-invalid={invalid === true ? true : undefined}
        containerClassName={cn(
          'flex items-center gap-xs has-[:disabled]:opacity-50',
          invalid === true && 'animate-field-shake',
          containerClassName,
        )}
        className={cn('disabled:cursor-not-allowed', className)}
        {...props}
      />
    </InputOTPStateContext.Provider>
  ),
);
InputOTP.displayName = 'InputOTP';

export const InputOTPGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center', className)} {...props} />
));
InputOTPGroup.displayName = 'InputOTPGroup';

export interface InputOTPSlotProps extends React.ComponentPropsWithoutRef<'div'> {
  index: number;
  /** Tints the slot border destructive. Falls back to the `invalid` set on the parent `InputOTP`. */
  invalid?: boolean;
  /** Tints the slot border success. Falls back to the `valid` set on the parent `InputOTP`. */
  valid?: boolean;
}

export const InputOTPSlot = React.forwardRef<HTMLDivElement, InputOTPSlotProps>(
  ({ index, className, invalid, valid, ...props }, ref) => {
    const otpContext = React.useContext(OTPInputContext);
    const state = React.useContext(InputOTPStateContext);
    const slot = otpContext?.slots[index];
    const char = slot?.char;
    const hasFakeCaret = slot?.hasFakeCaret;
    const isActive = slot?.isActive;

    // Per-slot prop wins; otherwise inherit the field-level flag from InputOTP.
    const isInvalid = invalid ?? state.invalid;
    const isValid = valid ?? state.valid;

    return (
      <div
        ref={ref}
        aria-invalid={isInvalid === true ? true : undefined}
        data-valid={isValid === true ? 'true' : undefined}
        className={cn(
          'border-border-input bg-input duration-fast ease-out-quart relative flex size-10 items-center justify-center border-y border-r text-sm font-semibold tabular-nums shadow-xs transition-colors first:rounded-l-md first:border-l last:rounded-r-md',
          'pointer-coarse:size-11',
          // Active slot is FOCUS, not selection — match the Input/Select field
          // focus idiom (ring border + focus shadow), never the --primary ring.
          isActive && 'border-ring shadow-focus z-10',
          'aria-invalid:border-destructive',
          'data-[valid=true]:border-success',
          className,
        )}
        {...props}
      >
        {char}
        {hasFakeCaret ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="bg-foreground animate-caret-blink h-4 w-px" />
          </div>
        ) : null}
      </div>
    );
  },
);
InputOTPSlot.displayName = 'InputOTPSlot';

export const InputOTPSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="separator"
    className={cn('text-muted-foreground flex items-center justify-center', className)}
    {...props}
  >
    <MinusSignIcon className="size-icon-sm" />
  </div>
));
InputOTPSeparator.displayName = 'InputOTPSeparator';
