/**
 * Deterministic palette index for an organization's avatar background.
 *
 * Maps `orgId` to one of 6 existing semantic tokens via a stable hash.
 * Same `orgId` always produces the same palette across sessions — the
 * user's mental model "Acme is always purple" relies on this.  No new
 * color tokens are introduced; we cycle through the 6 semantic tokens
 * the design system already ships.
 */

export type OrgAvatarPalette =
  | 'primary'
  | 'success'
  | 'warning'
  | 'info'
  | 'destructive'
  | 'accent';

const PALETTES: readonly OrgAvatarPalette[] = [
  'primary',
  'success',
  'warning',
  'info',
  'destructive',
  'accent',
];

/**
 * djb2-style string hash.  Stable across V8/JSCore/SpiderMonkey because
 * we use only basic arithmetic on UTF-16 code units.
 */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getOrgAvatarPalette(orgId: string): OrgAvatarPalette {
  const idx = hashString(orgId) % PALETTES.length;
  return PALETTES[idx]!;
}
