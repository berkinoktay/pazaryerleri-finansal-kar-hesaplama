import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncLog } from './logger';

describe('syncLog', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Freeze the clock so the pretty-mode HH:MM:SS prefix is deterministic.
    // Local components → getHours()/getMinutes()/getSeconds() are TZ-independent.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 21, 14, 32, 1));
  });

  afterEach(() => {
    vi.useRealTimers();
    logSpy.mockRestore();
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
  });

  it('emits a single JSON line in production', () => {
    process.env['NODE_ENV'] = 'production';
    syncLog.info('test.event', { workerId: 'w1', count: 3 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0]![0] as string;
    const parsed: Record<string, unknown> = JSON.parse(arg);
    expect(parsed).toMatchObject({
      level: 'info',
      event: 'test.event',
      workerId: 'w1',
      count: 3,
    });
    expect(typeof parsed['timestamp']).toBe('string');
  });

  it('includes hint as a plain field in production JSON', () => {
    process.env['NODE_ENV'] = 'production';
    syncLog.warn('db.unreachable', { host: '127.0.0.1', hint: 'Run supabase start.' });
    const parsed: Record<string, unknown> = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(parsed).toMatchObject({
      event: 'db.unreachable',
      host: '127.0.0.1',
      hint: 'Run supabase start.',
    });
  });

  it('uses pretty format with a clock prefix and · for info in non-production', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('worker.starting', { workerId: 'w-abc' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toBe('14:32:01 · [sync] worker.starting workerId=w-abc');
  });

  it('uses ! prefix for warn', () => {
    delete process.env['NODE_ENV'];
    syncLog.warn('sync.retryable', { syncLogId: 'abc', attemptCount: 2 });
    expect(logSpy.mock.calls[0]![0]).toBe(
      '14:32:01 ! [sync] sync.retryable syncLogId=abc attemptCount=2',
    );
  });

  it('uses ✗ prefix for error', () => {
    delete process.env['NODE_ENV'];
    syncLog.error('sync.failed', { syncLogId: 'x' });
    expect(logSpy.mock.calls[0]![0]).toBe('14:32:01 ✗ [sync] sync.failed syncLogId=x');
  });

  it('handles empty context', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('worker.stopped');
    expect(logSpy.mock.calls[0]![0]).toBe('14:32:01 · [sync] worker.stopped');
  });

  it('drops undefined values from pretty output', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('event', { a: 'kept', b: undefined, c: 7 });
    expect(logSpy.mock.calls[0]![0]).toBe('14:32:01 · [sync] event a=kept c=7');
  });

  it('JSON.stringifies nested objects in pretty output', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('chunk.start', { cursor: { kind: 'page', n: 3 } });
    expect(logSpy.mock.calls[0]![0]).toBe(
      '14:32:01 · [sync] chunk.start cursor={"kind":"page","n":3}',
    );
  });

  it('renders a hint after the context with an arrow, excluded from the key=value tail', () => {
    delete process.env['NODE_ENV'];
    syncLog.warn('db.unreachable', {
      host: '127.0.0.1',
      port: '54322',
      hint: 'Run supabase start.',
    });
    expect(logSpy.mock.calls[0]![0]).toBe(
      '14:32:01 ! [sync] db.unreachable host=127.0.0.1 port=54322 → Run supabase start.',
    );
  });

  it('renders a hint even when there is no other context', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('worker.config.webhook-disabled', { hint: 'Set PUBLIC_API_BASE_URL.' });
    expect(logSpy.mock.calls[0]![0]).toBe(
      '14:32:01 · [sync] worker.config.webhook-disabled → Set PUBLIC_API_BASE_URL.',
    );
  });
});
