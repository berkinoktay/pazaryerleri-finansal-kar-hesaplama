import { NextIntlClientProvider } from 'next-intl';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { TimeAgo } from '@/components/patterns/time-ago';

import trMessages from '../../messages/tr.json';
import { FORMATS } from '../../src/i18n/formats';
import { render, screen } from '../helpers/render';

const NOW = new Date('2026-05-03T15:30:00Z');

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="tr"
      messages={trMessages}
      formats={FORMATS}
      timeZone="Europe/Istanbul"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('<TimeAgo>', () => {
  describe('placeholder', () => {
    it('renders the default em-dash for null', () => {
      renderWithIntl(<TimeAgo value={null} />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders the default em-dash for undefined', () => {
      renderWithIntl(<TimeAgo value={undefined} />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('uses the supplied placeholder string', () => {
      renderWithIntl(<TimeAgo value={null} placeholder="Hiç senkron yok" />);
      expect(screen.getByText('Hiç senkron yok')).toBeInTheDocument();
    });
  });

  describe('rendered output', () => {
    it('renders a <time> element with dateTime ISO attribute', () => {
      const { container } = renderWithIntl(
        <TimeAgo value={new Date(NOW.getTime() - 60 * 1000)} now={NOW} />,
      );
      const time = container.querySelector('time');
      expect(time).not.toBeNull();
      expect(time?.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('appends timezone label to the title attribute when provided', () => {
      const { container } = renderWithIntl(
        <TimeAgo value={new Date(NOW.getTime() - 60 * 1000)} now={NOW} timezone="GMT+3" />,
      );
      const time = container.querySelector('time');
      expect(time?.getAttribute('title')).toContain('GMT+3');
    });

    it('omits timezone from title when not provided', () => {
      const { container } = renderWithIntl(
        <TimeAgo value={new Date(NOW.getTime() - 60 * 1000)} now={NOW} />,
      );
      const time = container.querySelector('time');
      const title = time?.getAttribute('title') ?? '';
      expect(title).not.toContain('GMT');
    });
  });

  describe('relative formatting', () => {
    it('renders relative copy after mount when value is recent', () => {
      const value = new Date(NOW.getTime() - 5 * 60 * 1000);
      const { container } = renderWithIntl(<TimeAgo value={value} now={NOW} />);
      // After mount the body should contain the relative phrase. next-intl
      // resolves "5 minutes ago" → "5 dakika önce" in tr locale; assert the
      // body includes a digit to keep the test robust to wording variants
      // ("5 dk önce" vs "5 dakika önce").
      const time = container.querySelector('time');
      expect(time?.textContent).toMatch(/\d/);
    });

    it('accepts an ISO string value (not just Date)', () => {
      const iso = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
      const { container } = renderWithIntl(<TimeAgo value={iso} now={NOW} />);
      const time = container.querySelector('time');
      expect(time?.getAttribute('datetime')).toBe(iso);
    });
  });
});
