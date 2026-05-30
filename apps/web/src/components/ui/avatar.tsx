'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { type ToneKey, toneSurfaceClass } from '@/lib/variants';
import { cn } from '@/lib/utils';

/**
 * User / organization avatar. Compose `AvatarImage` for the photo and
 * `AvatarFallback` for initials or a placeholder icon — Radix swaps to
 * the fallback automatically when the image fails to load. Sizes
 * `sm | md | lg` (32px / 40px / 48px) align with the Button / Input
 * size ladder so user rows stay rhythmically consistent.
 *
 * The Root size flows through context so `AvatarFallback` scales its
 * initials with the avatar (sm→12px, md→13px, lg→14px) without the
 * consumer repeating the size. Pass `tone` to tint the fallback surface
 * (org/user accents) instead of hand-rolling a bg/text pair — tones stay
 * in the hue-265 system via `toneSurfaceClass`. Pass `indicator` to attach
 * a StatusDot / badge / marketplace mark at the bottom-right corner (ringed
 * against the background so it reads as attached).
 *
 * @useWhen rendering a single user or organization avatar with image + initials fallback (the fallback shows automatically on image load failure)
 */

// Avatar uses the shared size ladder (sm/md/lg) — same keys as Button/Input/Badge.
// The default `md` (40px) is a comfortable target for profile chips and user rows;
// 24px was an icon-scale holdover and too small for a recognizable avatar.
const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-full', {
  variants: {
    size: {
      sm: 'size-8',
      md: 'size-10',
      lg: 'size-12',
    },
  },
  defaultVariants: { size: 'md' },
});

type AvatarSize = NonNullable<VariantProps<typeof avatarVariants>['size']>;

// Fallback initials scale with the Root size so consumers never repeat it.
const fallbackTextClass: Record<AvatarSize, string> = {
  sm: 'text-2xs',
  md: 'text-xs',
  lg: 'text-sm',
};

const AvatarSizeContext = React.createContext<AvatarSize>('md');

export interface AvatarProps
  extends
    React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {
  /**
   * Attached corner mark (StatusDot / badge / marketplace logo) rendered
   * absolutely at the bottom-right, ringed against the background so it
   * reads as fastened to the avatar rather than floating.
   */
  indicator?: React.ReactNode;
}

export const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, size, indicator, children, ...props }, ref) => {
    const resolvedSize: AvatarSize = size ?? 'md';

    // The Root keeps its own `overflow-hidden` (so the image stays clipped to
    // the circle); the indicator is a *sibling* in the relative wrapper, so it
    // can poke past the avatar edge without being clipped.
    if (indicator !== undefined) {
      return (
        <AvatarSizeContext.Provider value={resolvedSize}>
          <span className={cn('relative inline-flex shrink-0', className)}>
            <AvatarPrimitive.Root ref={ref} className={cn(avatarVariants({ size }))} {...props}>
              {children}
            </AvatarPrimitive.Root>
            <span className="ring-background absolute right-0 bottom-0 flex items-center justify-center rounded-full ring-2">
              {indicator}
            </span>
          </span>
        </AvatarSizeContext.Provider>
      );
    }

    return (
      <AvatarSizeContext.Provider value={resolvedSize}>
        <AvatarPrimitive.Root
          ref={ref}
          className={cn(avatarVariants({ size, className }))}
          {...props}
        >
          {children}
        </AvatarPrimitive.Root>
      </AvatarSizeContext.Provider>
    );
  },
);
Avatar.displayName = AvatarPrimitive.Root.displayName;

export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn(
      'size-full object-cover',
      'duration-fast ease-out-quart transition-opacity',
      className,
    )}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

export interface AvatarFallbackProps extends React.ComponentPropsWithoutRef<
  typeof AvatarPrimitive.Fallback
> {
  /**
   * Semantic surface tint for the fallback (org/user accent). Defaults to
   * `neutral` — the muted bg/text pairing. Sourced from `toneSurfaceClass`
   * so it stays inside the hue-265 token system.
   */
  tone?: ToneKey;
}

export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  AvatarFallbackProps
>(({ className, tone = 'neutral', ...props }, ref) => {
  const size = React.useContext(AvatarSizeContext);
  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        'flex size-full items-center justify-center rounded-full font-semibold',
        'duration-fast ease-out-quart transition-opacity',
        fallbackTextClass[size],
        toneSurfaceClass[tone],
        className,
      )}
      {...props}
    />
  );
});
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Shared size for every avatar in the row (drives the `+N` chip too). */
  size?: AvatarSize;
  /**
   * Cap on visible avatars. Children beyond this collapse into a single
   * `+N` overflow chip. Omit to render every child.
   */
  max?: number;
  /** Translated label prefix for the overflow chip's accessible title (e.g. "and 3 more"). */
  overflowLabel?: (count: number) => string;
}

/**
 * Overlapping row of avatars (member stacks, store collaborators). Children
 * are `Avatar` elements; the group lays them with a negative-margin overlap
 * and rings each one against the background so the stack reads as layered
 * discs rather than a smear. Pass `max` to collapse the tail into a `+N`
 * chip (rendered at the group `size`). Purely presentational.
 *
 * @useWhen showing a compact stack of related users/orgs; use a single Avatar for one entity
 */
export function AvatarGroup({
  children,
  size = 'md',
  max,
  overflowLabel,
  className,
  ...props
}: AvatarGroupProps): React.ReactElement {
  const items = React.Children.toArray(children);
  const visible = max !== undefined ? items.slice(0, max) : items;
  const overflowCount = items.length - visible.length;

  return (
    // Negative left margin on every child but the first creates the overlap;
    // `ring-background ring-2` (NOT ring-card) fastens each disc visually
    // above its neighbour. The selector applies to whatever the children
    // render (an Avatar's Root or the wrapper around an indicator).
    <div
      className={cn(
        'flex items-center',
        '[&>*]:ring-background [&>*]:rounded-full [&>*]:ring-2',
        '[&>*:not(:first-child)]:-ml-xs',
        className,
      )}
      {...props}
    >
      {visible}
      {overflowCount > 0 ? (
        <Avatar
          size={size}
          aria-label={overflowLabel?.(overflowCount)}
          role={overflowLabel !== undefined ? 'img' : undefined}
        >
          <AvatarFallback>{`+${overflowCount}`}</AvatarFallback>
        </Avatar>
      ) : null}
    </div>
  );
}

export { avatarVariants };
