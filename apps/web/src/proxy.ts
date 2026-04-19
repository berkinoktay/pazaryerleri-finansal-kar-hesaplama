import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { updateSession } from './lib/supabase/middleware';

const intl = createIntlMiddleware(routing);

// Routes that DO require an authenticated session.
const PROTECTED = ['/dashboard', '/onboarding', '/auth/verified'] as const;

// Routes where an already-authenticated user should bounce back to
// the dashboard (guests only).
const GUEST_ONLY = [
  '/login',
  '/register',
  '/check-email',
  '/forgot-password',
  // `/reset-password` is NOT guest-only: the user hits it from the
  // recovery email link with an active recovery session (technically
  // authenticated). The form itself handles the "no recovery session"
  // fallback.
] as const;

/**
 * Strip the optional locale prefix so path-matching can use clean
 * values like '/dashboard' regardless of whether the request hit
 * '/dashboard' (default locale) or '/en/dashboard'.
 */
function stripLocale(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0] as (typeof routing.locales)[number] | undefined;
  if (first !== undefined && routing.locales.includes(first)) {
    return '/' + segments.slice(1).join('/');
  }
  return pathname;
}

function isInGroup(path: string, group: readonly string[]): boolean {
  return group.some((p) => path === p || path.startsWith(p + '/'));
}

export default async function proxy(request: NextRequest) {
  const { response: sessionResponse, user } = await updateSession(request);

  const cleanPath = stripLocale(request.nextUrl.pathname);

  if (isInGroup(cleanPath, PROTECTED) && user === null) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isInGroup(cleanPath, GUEST_ONLY) && user !== null) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  // Delegate to next-intl for locale routing. next-intl returns its
  // own NextResponse; copy the refreshed session cookies onto it so
  // the browser sees a single consistent response.
  const intlResponse = intl(request);
  for (const cookie of sessionResponse.cookies.getAll()) {
    intlResponse.cookies.set(cookie);
  }
  return intlResponse;
}

export const config = {
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
