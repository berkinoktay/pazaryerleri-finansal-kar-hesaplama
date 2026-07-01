/** Density-scale bounds for a zoomable table. Default = the table's normal
 *  (100%) size, so it always opens at full size; the seller can then shrink the
 *  rows/cells down to 70% to fit a wide table without scroll, or nudge up to
 *  120% for readability. */
export const TABLE_SCALE_MIN = 0.7;
export const TABLE_SCALE_MAX = 1.2;
export const TABLE_SCALE_STEP = 0.1;
export const TABLE_SCALE_DEFAULT = 1;

/** Round to one decimal so 0.9 + 0.1 stays 1 (no float drift) and clamp. */
export function clampTableScale(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Math.min(TABLE_SCALE_MAX, Math.max(TABLE_SCALE_MIN, rounded));
}
