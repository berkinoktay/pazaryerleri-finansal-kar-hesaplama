import { AuthApiError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { supabaseAuthErrorKey } from '@/features/auth/lib/supabase-auth-error-key';

function authError(code: string): AuthApiError {
  const err = new AuthApiError(`supabase: ${code}`, 400, code);
  return err;
}

describe('supabaseAuthErrorKey', () => {
  it('maps invalid_credentials', () => {
    expect(supabaseAuthErrorKey(authError('invalid_credentials'))).toBe('invalidCredentials');
  });

  it('maps user_already_exists', () => {
    expect(supabaseAuthErrorKey(authError('user_already_exists'))).toBe('userAlreadyExists');
  });

  it('maps weak_password', () => {
    expect(supabaseAuthErrorKey(authError('weak_password'))).toBe('weakPassword');
  });

  it('maps email_not_confirmed', () => {
    expect(supabaseAuthErrorKey(authError('email_not_confirmed'))).toBe('emailNotConfirmed');
  });

  it('maps over_email_send_rate_limit', () => {
    expect(supabaseAuthErrorKey(authError('over_email_send_rate_limit'))).toBe('rateLimited');
  });

  it('falls back to generic for unknown code', () => {
    expect(supabaseAuthErrorKey(authError('something_new_from_supabase'))).toBe('generic');
  });

  it('falls back to generic for non-AuthApiError', () => {
    expect(supabaseAuthErrorKey(new Error('not a supabase error'))).toBe('generic');
  });
});
