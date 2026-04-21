import { AuthApiError } from '@supabase/supabase-js';

/**
 * Translate a Supabase AuthApiError into an i18n sub-key under
 * `auth.errors.supabase.*`. Forms look the key up with `useTranslations`
 * against that namespace; unknown codes fall back to 'generic'.
 *
 * Keep this table in sync with `messages/tr.json::auth.errors.supabase`.
 * Supabase's code list is documented at:
 * https://supabase.com/docs/reference/javascript/auth-api#error-codes
 */
export type SupabaseAuthErrorKey =
  | 'invalidCredentials'
  | 'userAlreadyExists'
  | 'weakPassword'
  | 'emailNotConfirmed'
  | 'emailAddressInvalid'
  | 'otpExpired'
  | 'rateLimited'
  | 'signupDisabled'
  | 'userBanned'
  | 'generic';

const CODE_MAP: Record<string, SupabaseAuthErrorKey> = {
  invalid_credentials: 'invalidCredentials',
  user_already_exists: 'userAlreadyExists',
  weak_password: 'weakPassword',
  email_not_confirmed: 'emailNotConfirmed',
  email_address_invalid: 'emailAddressInvalid',
  otp_expired: 'otpExpired',
  otp_disabled: 'signupDisabled',
  over_email_send_rate_limit: 'rateLimited',
  over_request_rate_limit: 'rateLimited',
  signup_disabled: 'signupDisabled',
  user_banned: 'userBanned',
};

export function supabaseAuthErrorKey(err: unknown): SupabaseAuthErrorKey {
  if (err instanceof AuthApiError && typeof err.code === 'string') {
    return CODE_MAP[err.code] ?? 'generic';
  }
  return 'generic';
}
