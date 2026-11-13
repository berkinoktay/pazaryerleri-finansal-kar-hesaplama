// Shape checks for data that crossed the worker boundary. A structured clone keeps
// plain data only, so both sides check what they receive with these guards.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
