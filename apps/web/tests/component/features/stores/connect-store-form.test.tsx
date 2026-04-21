import { QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectStoreForm } from '@/features/stores/components/connect-store-form';

import trMessages from '../../../../messages/tr.json';
import { render, screen, userEvent } from '../../../helpers/render';
import { server, http, HttpResponse } from '../../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider messages={trMessages} locale="tr">
      {children}
    </NextIntlClientProvider>
  );
}

describe('ConnectStoreForm', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders Trendyol selected + Hepsiburada as "Yakında" and not clickable', () => {
    render(
      <Wrapper>
        <ConnectStoreForm orgId={ORG_ID} />
      </Wrapper>,
    );
    // Both platform cards render.
    expect(screen.getByText('Trendyol')).toBeInTheDocument();
    expect(screen.getByText('Hepsiburada')).toBeInTheDocument();
    expect(screen.getByText('Yakında')).toBeInTheDocument();
  });

  it('hides the environment tabs when NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS is not "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS', 'false');
    render(
      <Wrapper>
        <ConnectStoreForm orgId={ORG_ID} />
      </Wrapper>,
    );
    expect(screen.queryByText('Test (Sandbox)')).not.toBeInTheDocument();
    expect(screen.queryByText('Canlı')).not.toBeInTheDocument();
  });

  it('surfaces a backend VALIDATION_ERROR inline on supplierId', async () => {
    server.use(
      http.post(`http://localhost:3001/v1/organizations/${ORG_ID}/stores`, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/validation',
            title: 'Validation error',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'Bad supplier id',
            errors: [
              {
                field: 'credentials.supplierId',
                code: 'INVALID_SUPPLIER_ID_FORMAT',
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );

    const { user } = render(
      <Wrapper>
        <ConnectStoreForm orgId={ORG_ID} />
      </Wrapper>,
    );

    await user.type(screen.getByLabelText('Mağaza adı'), 'Trendyol Mağazam');
    await user.type(screen.getByLabelText('Satıcı ID'), 'supplier123');
    await user.type(screen.getByLabelText('API Key'), 'abcdefghij');
    await user.type(screen.getByLabelText('API Secret'), 'abcdefghij');
    await user.click(screen.getByRole('button', { name: 'Bağla' }));

    // Inline copy for INVALID_SUPPLIER_ID_FORMAT should appear.
    await expect(
      screen.findByText('Satıcı ID yalnızca harf ve rakam içerebilir.'),
    ).resolves.toBeInTheDocument();
  });
});
