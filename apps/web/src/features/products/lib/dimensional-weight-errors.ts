import { ApiError } from '@/lib/api-error';

// Shared validation-error vocabulary for every desi mutation surface
// (single-variant popover, bulk dialog, any future bulk variants). Lives
// here rather than in the consumers so the union stays in one place and
// every surface stays in sync when the backend grows a new code.

export const DIMENSIONAL_WEIGHT_ERROR_CODES = [
  'INVALID_DIMENSIONAL_WEIGHT_FORMAT',
  'INVALID_DIMENSIONAL_WEIGHT_TOO_SMALL',
  'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE',
] as const;

export type DimensionalWeightErrorCode = (typeof DIMENSIONAL_WEIGHT_ERROR_CODES)[number];

export function isDimensionalWeightErrorCode(code: string): code is DimensionalWeightErrorCode {
  return (DIMENSIONAL_WEIGHT_ERROR_CODES as readonly string[]).includes(code);
}

export function pickDimensionalWeightErrorCode(err: unknown): DimensionalWeightErrorCode | null {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return null;
  const issue = err.problem.errors?.find((e) => isDimensionalWeightErrorCode(e.code));
  return issue !== undefined && isDimensionalWeightErrorCode(issue.code) ? issue.code : null;
}
