/**
 * The one order of a cost profile's versions (plan PR-3b, amendment A11): the
 * version number. `effectiveFrom` defaults to the writing transaction's start time,
 * so two overlapping writes (an archive and a restore) can commit in the opposite
 * order of their `effectiveFrom`; the version number is assigned under the profile
 * row's lock and grows in commit order. `effectiveFrom` only says from when a version
 * may apply, and breaks a tie between equal numbers (the database keeps (profileId,
 * version) unique, so a tie exists only in hand-built inputs).
 */

/** The fields that order a cost profile's versions. */
export interface OrderedCostVersion {
  readonly effectiveFrom: Date;
  readonly versionNumber: number;
}

/** True when `a` is older than `b`: the lower version number, else the earlier effectiveFrom. */
export function versionPrecedes(a: OrderedCostVersion, b: OrderedCostVersion): boolean {
  if (a.versionNumber !== b.versionNumber) return a.versionNumber < b.versionNumber;
  return a.effectiveFrom.getTime() < b.effectiveFrom.getTime();
}

/**
 * The version in force at `instant`: the newest version (by `versionPrecedes`) among
 * those effective on or before it (inclusive); null when none is. The element is
 * returned as passed in.
 */
export function latestVersionAt<V extends OrderedCostVersion>(
  versions: readonly V[],
  instant: Date,
): V | null {
  const time = instant.getTime();
  let latest: V | null = null;
  for (const version of versions) {
    if (version.effectiveFrom.getTime() > time) continue;
    if (latest === null || versionPrecedes(latest, version)) {
      latest = version;
    }
  }
  return latest;
}
