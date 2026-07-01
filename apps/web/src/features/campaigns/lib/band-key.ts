import type { BandKey } from '../types';

/** The four band keys in top-down order (band1 = current tier … band4 = lowest). */
export const BAND_KEYS: readonly BandKey[] = ['band1', 'band2', 'band3', 'band4'];

/**
 * Narrows a raw band key string (the API types band keys as `string`) to the
 * `BandKey` union, or `undefined` when it is not one of the four. Used when
 * feeding a band key into the estimate/selection request bodies, which are typed
 * to the enum.
 */
export function asBandKey(key: string | null): BandKey | undefined {
  return BAND_KEYS.find((candidate) => candidate === key);
}
