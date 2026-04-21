import { QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoresEmptyState } from '@/features/stores/components/stores-empty-state';

import trMessages from '../../../../messages/tr.json';
import { createTestQueryClient, render, screen } from '../../../helpers/render';

const ORG_ID = '00000000-0000-0000-0000-000000000099';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe('StoresEmptyState', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the title + subtitle + CTA', () => {
    render(
      <Wrapper>
        <StoresEmptyState orgId={ORG_ID} />
      </Wrapper>,
    );
    expect(screen.getByRole('heading', { name: 'Mağazanı bağla' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bağla' })).toBeInTheDocument();
  });

  it('opens the connect-store modal when the CTA is clicked', async () => {
    const { user } = render(
      <Wrapper>
        <StoresEmptyState orgId={ORG_ID} />
      </Wrapper>,
    );
    await user.click(screen.getByRole('button', { name: 'Bağla' }));
    // Modal content surfaces the supplierId label — proof the dialog is open.
    expect(await screen.findByLabelText('Satıcı ID')).toBeInTheDocument();
  });
});
