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
 * @useWhen rendering a one-time-password or verification-code field split into per-character slots
 */
export const InputOTP = React.forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      'flex items-center gap-xs has-[:disabled]:opacity-50',
      containerClassName,
    )}
    className={cn('disabled:cursor-not-allowed', className)}
    {...props}
  />
));
InputOTP.displayName = 'InputOTP';

export const InputOTPGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center', className)} {...props} />
));
InputOTPGroup.displayName = 'InputOTPGroup';

export const InputOTPSlot = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'> & { index: number }
>(({ index, className, ...props }, ref) => {
  const otpContext = React.useContext(OTPInputContext);
  const slot = otpContext?.slots[index];
  const char = slot?.char;
  const hasFakeCaret = slot?.hasFakeCaret;
  const isActive = slot?.isActive;

  return (
    <div
      ref={ref}
      className={cn(
        'border-border duration-fast relative flex size-10 items-center justify-center border-y border-r text-sm font-semibold tabular-nums shadow-xs transition-all first:rounded-l-md first:border-l last:rounded-r-md',
        isActive && 'ring-primary z-10 ring-2',
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="bg-foreground duration-base h-4 w-px animate-pulse" />
        </div>
      ) : null}
    </div>
  );
});
InputOTPSlot.displayName = 'InputOTPSlot';

export function InputOTPSeparator(
  props: React.ComponentPropsWithoutRef<'div'>,
): React.ReactElement {
  return (
    <div role="separator" {...props}>
      <MinusSignIcon className="size-icon-sm text-muted-foreground" />
    </div>
  );
}
