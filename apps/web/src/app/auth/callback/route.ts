import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Supabase Auth redirect target.
 *
 * Deliberately mounted OUTSIDE the `[locale]` group so the URL the
 * Supabase dashboard / email templates redirect to is stable
 * (`/auth/callback`) regardless of which locale the user was browsing
 * when they signed up or requested a password reset.
 *
 * Query params we handle:
 *   - `code`  — auth code to exchange for a session. Supabase attaches
 *                this for email confirmation, OAuth, and recovery links.
 *   - `next`  — optional relative path to redirect to on success.
 *                Defaults to `/dashboard` for normal flows.
 *                Forgot-password flow sets `next=/reset-password`.
 *
 * On failure we redirect to `/login?error=auth-callback-failed`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code === null) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-missing-code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error !== null) {
    return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
