import { randomBytes } from 'node:crypto';

import { prisma } from '@pazarsync/db';

/**
 * Deterministic URL-safe slug transform.
 *
 * Turkish diacritic handling: ı/İ need explicit mapping because they
 * are precomposed codepoints with no NFD decomposition (ı is just a
 * dotless i, not "i + combining dot"). Every other Turkish letter
 * (ç ğ ö ş ü) decomposes under NFD and the combining mark gets stripped.
 *
 * Anything that survives (non-alphanumeric after stripping marks) is
 * collapsed to hyphens; leading/trailing hyphens are trimmed.
 *
 * Examples:
 *   slugify("Akyıldız Ticaret")        → "akyildiz-ticaret"
 *   slugify("ŞEKER GIDA A.Ş.")         → "seker-gida-a-s"
 *   slugify("!!!")                     → ""      (caller must fallback)
 *   slugify("  foo   bar  ")           → "foo-bar"
 */
export function slugify(input: string): string {
  const preMapped = input.trim().replaceAll('ı', 'i').replaceAll('İ', 'i');
  return preMapped
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Produce a slug that is guaranteed unique against the `organizations`
 * table, with a retry budget.
 *
 * ──────────────────────────────────────────────────────────────────────
 * [USER TOUCHPOINT #1 — Collision strategy]
 *
 * Trade-offs worth reconsidering:
 *  - MAX_ATTEMPTS: 10 means "akyildiz-ticaret-11" is the highest clean
 *    numbered suffix. Beyond that we fall back to a 6-hex random suffix.
 *    Raise to 50? 100? Keep low to avoid many DB roundtrips on popular
 *    names but accept occasional ugly slugs.
 *  - Suffix style: incrementing numeric (`-2`, `-3`) is predictable but
 *    leaks "you're the Nth person to pick this name." Random suffix
 *    (`-a3f8b1`) reveals nothing but is uglier.
 *  - Fallback: 6 hex chars = 16.7M possible values, collision-proof
 *    in practice. Could use longer or a human-readable word list.
 *  - Race safety: two concurrent POSTs with the same name may both
 *    pass the findUnique probe and then race on INSERT. The DB unique
 *    constraint wins that race; the caller catches Prisma's
 *    `P2002` and retries once via `createOrganization`. No retry loop
 *    needed here because the retry is already at the transaction level.
 * ──────────────────────────────────────────────────────────────────────
 */
const MAX_ATTEMPTS = 10;
const FALLBACK_BYTES = 3;

export async function generateUniqueOrganizationSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (base.length === 0) {
    return `organization-${randomBytes(FALLBACK_BYTES).toString('hex')}`;
  }

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.organization.findUnique({ where: { slug: candidate } });
    if (existing === null) return candidate;
  }

  return `${base}-${randomBytes(FALLBACK_BYTES).toString('hex')}`;
}
