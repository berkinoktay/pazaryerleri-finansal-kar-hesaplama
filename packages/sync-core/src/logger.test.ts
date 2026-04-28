import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncLog } from './logger';

describe('syncLog', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
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

  it('uses pretty format with · prefix for info in non-production', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('worker.starting', { workerId: 'w-abc' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toBe('· [sync] worker.starting workerId=w-abc');
  });

  it('uses ! prefix for warn', () => {
    delete process.env['NODE_ENV'];
    syncLog.warn('sync.retryable', { syncLogId: 'abc', attemptCount: 2 });
    expect(logSpy.mock.calls[0]![0]).toBe('! [sync] sync.retryable syncLogId=abc attemptCount=2');
  });

  it('uses ✗ prefix for error', () => {
    delete process.env['NODE_ENV'];
    syncLog.error('sync.failed', { syncLogId: 'x' });
    expect(logSpy.mock.calls[0]![0]).toBe('✗ [sync] sync.failed syncLogId=x');
  });

  it('handles empty context', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('worker.stopped');
    expect(logSpy.mock.calls[0]![0]).toBe('· [sync] worker.stopped');
  });

  it('drops undefined values from pretty output', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('event', { a: 'kept', b: undefined, c: 7 });
    expect(logSpy.mock.calls[0]![0]).toBe('· [sync] event a=kept c=7');
  });

  it('JSON.stringifies nested objects in pretty output', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('chunk.start', { cursor: { kind: 'page', n: 3 } });
    expect(logSpy.mock.calls[0]![0]).toBe('· [sync] chunk.start cursor={"kind":"page","n":3}');
  });
});
