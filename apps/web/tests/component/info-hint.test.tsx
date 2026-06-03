import { describe, expect, it } from 'vitest';

import { InfoHint } from '@/components/patterns/info-hint';

import { render, screen } from '../helpers/render';

describe('<InfoHint>', () => {
  it('renders an info button named after the label', () => {
    render(<InfoHint label="Net Kâr">Gerçek kazanç.</InfoHint>);
    expect(screen.getByRole('button', { name: 'Net Kâr' })).toBeInTheDocument();
  });

  it('falls back to a localized accessible name without a label', () => {
    render(<InfoHint>Açıklama.</InfoHint>);
    expect(screen.getByRole('button', { name: 'Bilgi' })).toBeInTheDocument();
  });
});
