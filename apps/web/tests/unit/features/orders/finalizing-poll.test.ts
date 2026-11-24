import { describe, expect, it } from 'vitest';

import {
  FINALIZING_POLL_MAX_MS,
  FINALIZING_POLL_MS,
  finalizingPollInterval,
} from '@/features/orders/lib/finalizing-poll';

describe('finalizingPollInterval', () => {
  it('polls while finalizing inside the window', () => {
    expect(finalizingPollInterval({ finalizing: true, startedAt: 0, now: 1_000 })).toBe(
      FINALIZING_POLL_MS,
    );
  });

  it('stops once the window reaches FINALIZING_POLL_MAX_MS', () => {
    // Control: one ms before the cap it still polls.
    expect(
      finalizingPollInterval({ finalizing: true, startedAt: 0, now: FINALIZING_POLL_MAX_MS - 1 }),
    ).toBe(FINALIZING_POLL_MS);

    expect(
      finalizingPollInterval({ finalizing: true, startedAt: 0, now: FINALIZING_POLL_MAX_MS }),
    ).toBe(false);
  });

  it('does not poll when the response is not finalizing', () => {
    // Control: the same window polls while finalizing.
    expect(finalizingPollInterval({ finalizing: true, startedAt: 0, now: 1_000 })).toBe(
      FINALIZING_POLL_MS,
    );

    expect(finalizingPollInterval({ finalizing: false, startedAt: null, now: 1_000 })).toBe(false);
    expect(finalizingPollInterval({ finalizing: undefined, startedAt: null, now: 1_000 })).toBe(
      false,
    );
  });
});
