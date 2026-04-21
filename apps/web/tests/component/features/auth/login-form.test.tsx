import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { LoginForm } from '@/features/auth/components/login-form';
import trMessages from '../../../../messages/tr.json';

import { render, screen } from '../../../helpers/render';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('error=otp_expired'),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn(),
    },
  }),
}));

function renderForm() {
  return render(
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <LoginForm />
    </NextIntlClientProvider>,
  );
}

describe('<LoginForm>', () => {
  it('surfaces a callback error from ?error=otp_expired', () => {
    renderForm();

    expect(
      screen.getByText('Doğrulama bağlantısının süresi dolmuş. Lütfen yeni bir bağlantı iste.'),
    ).toBeInTheDocument();
  });
});
