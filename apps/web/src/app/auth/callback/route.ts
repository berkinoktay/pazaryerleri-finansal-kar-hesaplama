import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Supabase Auth redirect target.
 *
 * Mounted OUTSIDE the `[locale]` group so the URL Supabase redirects to
 * stays stable (`/auth/callback`) regardless of the user's locale. The
 * proxy.ts matcher excludes this path from next-intl rewriting — the
 * request must reach this Route Handler untouched.
 *
 * Query params:
 *   - `code`  — auth code to exchange for a session (PKCE). Supabase
 *                attaches this after successful email verification,
 *                OAuth, or password-recovery clicks.
 *   - `next`  — optional relative path to redirect to on success.
 *                Defaults to `/dashboard`. Signup flow uses
 *                `/auth/verified`, password reset uses `/reset-password`.
 *   - `error` + `error_code` + `error_description` — Supabase attaches
 *                these when verification failed before we even got a
 *                code (expired link, already-used token, revoked user).
 *
 * Failure paths land on `/login?error=<code>` so the i18n layer can
 * translate to a user-facing message rather than surface Supabase
 * internals.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get('next') ?? '/dashboard';

  const supabaseError = searchParams.get('error_code') ?? searchParams.get('error');
  if (supabaseError !== null) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(supabaseError)}`);
  }

  const code = searchParams.get('code');
  if (code === null) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-missing-code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error !== null) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.code ?? 'auth-callback-failed')}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
