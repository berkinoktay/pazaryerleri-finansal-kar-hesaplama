import { redirect } from 'next/navigation';

/**
 * /settings is the entry point — redirect to the first sub-page so
 * the secondary sidebar always has an active row.  Matches the
 * Linear / Stripe convention.
 */
export default function SettingsIndexPage(): never {
  redirect('/settings/profile');
}
