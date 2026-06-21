import { syncLog } from '@pazarsync/sync-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDbConnectivityReporter } from '../../../src/lib/db-connectivity';

function prismaUnreachable(): Error {
  return Object.assign(new Error("Can't reach database server at 127.0.0.1:54322"), {
    code: 'P1001',
  });
}

describe('createDbConnectivityReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 21, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs a single db.unreachable warning on the first unreachable error and suppresses repeats', () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => {});
    const reporter = createDbConnectivityReporter();

    reporter.logBackgroundError('worker.outer.error', prismaUnreachable());
    reporter.logBackgroundError('buffer.promote-tick-error', prismaUnreachable());
    reporter.logBackgroundError('resolution.tick-error', prismaUnreachable());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'db.unreachable',
      expect.objectContaining({ host: '127.0.0.1', port: '54322', hint: expect.any(String) }),
    );
  });

  it('emits a throttled still-down heartbeat only after the interval elapses', () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => {});
    const reporter = createDbConnectivityReporter();

    reporter.logBackgroundError('e', prismaUnreachable());
    vi.advanceTimersByTime(59_000);
    reporter.logBackgroundError('e', prismaUnreachable()); // still suppressed
    expect(warn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000); // now 60s in
    reporter.logBackgroundError('e', prismaUnreachable());
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      'db.unreachable.still',
      expect.objectContaining({ downForSec: 60 }),
    );
  });

  it('logs db.reconnected exactly once after recovery', () => {
    vi.spyOn(syncLog, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(syncLog, 'info').mockImplementation(() => {});
    const reporter = createDbConnectivityReporter();

    reporter.logBackgroundError('e', prismaUnreachable());
    vi.advanceTimersByTime(5_000);
    reporter.reportDbHealthy();
    reporter.reportDbHealthy(); // no double-log

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('db.reconnected', expect.objectContaining({ downForSec: 5 }));
  });

  it('re-arms after recovery so a second outage warns again', () => {
    const warn = vi.spyOn(syncLog, 'warn').mockImplementation(() => {});
    vi.spyOn(syncLog, 'info').mockImplementation(() => {});
    const reporter = createDbConnectivityReporter();

    reporter.logBackgroundError('e', prismaUnreachable());
    reporter.reportDbHealthy();
    reporter.logBackgroundError('e', prismaUnreachable());

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, 'db.unreachable', expect.anything());
    expect(warn).toHaveBeenNthCalledWith(2, 'db.unreachable', expect.anything());
  });

  it('passes a non-DB error straight through as an error log with its event name', () => {
    const error = vi.spyOn(syncLog, 'error').mockImplementation(() => {});
    const reporter = createDbConnectivityReporter();

    reporter.logBackgroundError('buffer.promote-tick-error', new Error('boom'), { workerId: 'w1' });

    expect(error).toHaveBeenCalledWith(
      'buffer.promote-tick-error',
      expect.objectContaining({ workerId: 'w1', errorMessage: 'boom' }),
    );
  });

  it('does not log reconnected when it was never disconnected', () => {
    const info = vi.spyOn(syncLog, 'info').mockImplementation(() => {});
    const reporter = createDbConnectivityReporter();

    reporter.reportDbHealthy();

    expect(info).not.toHaveBeenCalled();
  });
});
