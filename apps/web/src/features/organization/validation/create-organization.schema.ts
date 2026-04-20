import { z } from 'zod';

/**
 * Client-side mirror of the backend validator. The error messages are
 * SCREAMING_SNAKE_CASE codes so the form can translate via i18n
 * (organizations.create.errors.<code>) without hardcoding Turkish or
 * English anywhere in the form component.
 *
 * Keep the rules in sync with
 * apps/api/src/validators/organization.validator.ts. A mismatch is a
 * caught-by-server-400 bug, not a silent one — but duplicated logic
 * saves a roundtrip on common validation failures.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'www',
  'app',
  'help',
  'support',
  'docs',
  'settings',
  'billing',
  'onboarding',
  'dashboard',
  'organizations',
  'stores',
]);

function normaliseForReservedCheck(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll('ı', 'i')
    .replaceAll('i̇', 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'INVALID_NAME_TOO_SHORT')
    .max(80, 'INVALID_NAME_TOO_LONG')
    .regex(/[\p{L}\p{N}]/u, 'INVALID_NAME_NO_ALPHANUMERIC')
    .refine((v) => !RESERVED_NAMES.has(normaliseForReservedCheck(v)), 'INVALID_NAME_RESERVED'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
