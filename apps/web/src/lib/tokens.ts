/**
 * Type-safe token key registry
 *
 * Listing tokens here gives IDE autocomplete and keeps the palette
 * enumerable for places like the showcase page, chart color pickers,
 * and the ESLint rule that guards against inline color hex usage.
 */

export const COLOR_TOKENS = [
  'background',
  'foreground',
  'muted',
  'muted-foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'border',
  'border-strong',
  'input',
  'ring',
  'primary',
  'primary-foreground',
  'primary-hover',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'success',
  'success-foreground',
  'success-surface',
  'destructive',
  'destructive-foreground',
  'destructive-surface',
  'warning',
  'warning-foreground',
  'warning-surface',
  'info',
  'info-foreground',
  'info-surface',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

export const SEMANTIC_COLORS = [
  { key: 'success', surface: 'success-surface', foreground: 'success-foreground' },
  { key: 'destructive', surface: 'destructive-surface', foreground: 'destructive-foreground' },
  { key: 'warning', surface: 'warning-surface', foreground: 'warning-foreground' },
  { key: 'info', surface: 'info-surface', foreground: 'info-foreground' },
] as const;

export const SPACING_TOKENS = [
  '3xs',
  '2xs',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
] as const;
export type SpacingToken = (typeof SPACING_TOKENS)[number];

export const TEXT_TOKENS = [
  '2xs',
  'xs',
  'sm',
  'base',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
] as const;
export type TextToken = (typeof TEXT_TOKENS)[number];

export const RADIUS_TOKENS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'full'] as const;
export type RadiusToken = (typeof RADIUS_TOKENS)[number];

export const SHADOW_TOKENS = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export type ShadowToken = (typeof SHADOW_TOKENS)[number];

export const MOTION_DURATIONS = ['instant', 'fast', 'base', 'slow', 'entrance'] as const;
export type MotionDuration = (typeof MOTION_DURATIONS)[number];

export const MOTION_EASINGS = [
  'ease-out-quart',
  'ease-out-quint',
  'ease-out-expo',
  'ease-in-out-quad',
] as const;
export type MotionEasing = (typeof MOTION_EASINGS)[number];
