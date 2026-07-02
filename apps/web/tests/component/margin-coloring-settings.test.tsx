import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';

import { MarginColoringSettings } from '@/features/account/components/margin-coloring-settings';

import { render, screen, createTestQueryClient } from '../helpers/render';
import { server, http, HttpResponse } from '../helpers/msw';

const TEST_API_BASE = 'http://localhost:3001';

const ENABLED_PREFERENCES = {
  marginColoring: {
    enabled: true,
    buckets: [
      { threshold: -10, color: 'oklch(58% 0.20 27)' },
      { threshold: 0, color: 'oklch(57% 0.17 75)' },
      { threshold: 10, color: 'oklch(59% 0.15 115)' },
      { threshold: 25, color: 'oklch(58% 0.15 140)' },
      { threshold: 50, color: 'oklch(58% 0.14 155)' },
    ],
  },
};

function setup(preferences = {}, patchResponse?: object) {
  const queryClient = createTestQueryClient();

  server.use(
    http.get(`${TEST_API_BASE}/v1/me/preferences`, () => HttpResponse.json({ data: preferences })),
  );

  if (patchResponse !== undefined) {
    server.use(
      http.patch(`${TEST_API_BASE}/v1/me/preferences`, () =>
        HttpResponse.json({ data: patchResponse }),
      ),
    );
  }

  // render() from helpers wraps with NextIntlClientProvider + QueryClientProvider.
  // We override the queryClient so we can inspect state after mutations.
  const result = render(<MarginColoringSettings />, { queryClient });

  return { ...result, queryClient };
}

describe('<MarginColoringSettings>', () => {
  describe('initial render', () => {
    it('shows the section title', async () => {
      setup({});
      // The title contains "Renklendirme" — multiple elements may match because
      // the description also mentions it. Use getAllByText and verify at least one.
      const matches = screen.getAllByText(/Renklendirme/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('shows the enable toggle switch', async () => {
      setup({});
      // The card renders a skeleton until the preferences seed lands (data-loss
      // guard) — wait for the interactive switch to appear.
      const toggle = await screen.findByRole('switch', { name: /renklendirme/i });
      expect(toggle).toBeInTheDocument();
    });

    it('loads existing preferences and shows them', async () => {
      setup(ENABLED_PREFERENCES);
      await waitFor(() => {
        const toggle = screen.getByRole('switch', { name: /renklendirme/i });
        expect(toggle).toBeChecked();
      });
    });
  });

  describe('enable toggle', () => {
    it('toggles the enabled state', async () => {
      const { user } = setup({});
      const toggle = await screen.findByRole('switch', { name: /renklendirme/i });
      expect(toggle).not.toBeChecked();

      await user.click(toggle);
      expect(toggle).toBeChecked();
    });
  });

  describe('bucket list', () => {
    it('shows add bucket button when under the 8-bucket limit', async () => {
      setup({});
      await waitFor(() => {
        // Default has 5 buckets — add button should be visible.
        // The Turkish label "Aralik ekle" may have diacritics; match the core stem.
        expect(screen.getByRole('button', { name: /ekle/i })).toBeInTheDocument();
      });
    });

    it('adds a bucket on clicking add', async () => {
      const { user } = setup({});

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /ekle/i })).toBeInTheDocument();
      });

      // Get initial threshold inputs count.
      const initialInputs = screen.getAllByRole('spinbutton');
      const initialCount = initialInputs.length;

      await user.click(screen.getByRole('button', { name: /ekle/i }));

      const newInputs = screen.getAllByRole('spinbutton');
      expect(newInputs).toHaveLength(initialCount + 1);
    });

    it('removes a bucket on clicking remove', async () => {
      const { user } = setup(ENABLED_PREFERENCES);

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /kald/i }).length).toBeGreaterThan(0);
      });

      const initialInputs = screen.getAllByRole('spinbutton');
      const initialCount = initialInputs.length;

      // Remove the first removable bucket.
      const removeBtns = screen.getAllByRole('button', { name: /kald/i });
      await user.click(removeBtns[0]!);

      const newInputs = screen.getAllByRole('spinbutton');
      expect(newInputs).toHaveLength(initialCount - 1);
    });

    it('disables remove when only 2 buckets remain', async () => {
      // Load with 2 buckets — minimum allowed.
      setup({
        marginColoring: {
          enabled: true,
          buckets: [
            { threshold: 0, color: 'oklch(58% 0.20 27)' },
            { threshold: 50, color: 'oklch(58% 0.14 155)' },
          ],
        },
      });

      await waitFor(() => {
        // Floor model: 2 buckets expose 1 threshold input (the first is the floor).
        expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
      });

      const removeBtns = screen.getAllByRole('button', { name: /kald/i });
      for (const btn of removeBtns) {
        expect(btn).toBeDisabled();
      }
    });

    it('reset-to-default restores the 5-bucket default', async () => {
      const { user } = setup({
        marginColoring: {
          enabled: true,
          buckets: [
            { threshold: 0, color: 'oklch(58% 0.20 27)' },
            { threshold: 50, color: 'oklch(58% 0.14 155)' },
          ],
        },
      });

      await waitFor(() => {
        expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
      });

      await user.click(screen.getByRole('button', { name: /varsay/i }));

      // Default has 5 buckets → 4 threshold inputs (first is the floor).
      await waitFor(() => {
        expect(screen.getAllByRole('spinbutton')).toHaveLength(4);
      });
    });
  });

  describe('color picker', () => {
    it('shows color swatch pickers for each bucket', async () => {
      setup(ENABLED_PREFERENCES);

      await waitFor(() => {
        // Each bucket should have a color swatch picker trigger (aria-label = "Renk sec").
        const pickers = screen.getAllByRole('button', { name: /renk se/i });
        expect(pickers.length).toBeGreaterThanOrEqual(5);
      });
    });
  });

  describe('live preview', () => {
    it('renders the preview section', async () => {
      setup({});
      // "Onizleme" / "Önizleme" — match by partial word. The preview only
      // renders after the preferences seed lands (skeleton until then).
      expect(await screen.findByText(/nizleme/)).toBeInTheDocument();
    });
  });

  describe('save', () => {
    it('calls PATCH preferences when Kaydet is clicked', async () => {
      let patchCalled = false;
      const { user } = setup({}, ENABLED_PREFERENCES);

      // Override with a handler that tracks the call.
      // This test registers its own handler after setup's PATCH handler,
      // but since we did NOT register a PATCH in setup when patchResponse
      // is passed, this handler is the only one.
      server.use(
        http.patch(`${TEST_API_BASE}/v1/me/preferences`, () => {
          patchCalled = true;
          return HttpResponse.json({ data: ENABLED_PREFERENCES });
        }),
      );

      // Save appears (and becomes enabled) only after the seed lands — the
      // pending-state skeleton guards against saving defaults over stored prefs.
      const saveBtn = await screen.findByRole('button', { name: /kaydet/i });
      await user.click(saveBtn);

      await waitFor(() => {
        expect(patchCalled).toBe(true);
      });
    });

    it('disables Kaydet while mutation is pending', async () => {
      const { user } = setup({});

      // Register a PATCH handler that hangs to observe the pending state.
      server.use(
        http.patch(`${TEST_API_BASE}/v1/me/preferences`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          return HttpResponse.json({ data: ENABLED_PREFERENCES });
        }),
      );

      const saveBtn = await screen.findByRole('button', { name: /kaydet/i });
      // Click and immediately check for disabled state.
      void user.click(saveBtn);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /kaydet/i })).toBeDisabled();
      });
    });
  });
});
