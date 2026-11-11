// Pins the in-request profit fallback's failure routing: with a request-level failure sink
// the error is recorded there (one log line per request, flushed by the caller); without
// one it is logged at once; an unsupported platform is an expected case and stays silent
// on both paths. The engine's computeParcelProfit is mocked so no database is touched.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';

import { computeParcelProfit, UnsupportedPlatformError } from '@pazarsync/profit';

import { computeParcelProfitForRead } from '@/services/profit-compute-fallback.service';
import { type RequestFailureLog } from '@/services/scenario-screen-commons';

vi.mock('@pazarsync/profit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pazarsync/profit')>();
  return {
    ...actual,
    computeParcelProfit: vi.fn(),
  };
});

const ORG_ID = 'org-test';
const ORDER_ID = 'order-test';

interface SpySink extends RequestFailureLog {
  readonly record: Mock<RequestFailureLog['record']>;
  readonly flush: Mock<RequestFailureLog['flush']>;
}

function makeSink(): SpySink {
  return {
    record: vi.fn<RequestFailureLog['record']>(),
    flush: vi.fn<RequestFailureLog['flush']>(),
  };
}

describe('computeParcelProfitForRead failure routing', () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.mocked(computeParcelProfit).mockReset();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('records a compute failure in the sink instead of logging it', async () => {
    const failure = new Error('engine exploded');
    vi.mocked(computeParcelProfit).mockRejectedValue(failure);
    const sink = makeSink();

    const result = await computeParcelProfitForRead({
      organizationId: ORG_ID,
      orderId: ORDER_ID,
      surface: 'live-performance',
      failures: sink,
    });

    expect(result).toBeNull();
    expect(sink.record).toHaveBeenCalledTimes(1);
    expect(sink.record).toHaveBeenCalledWith(failure, ORDER_ID);
    expect(sink.flush).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('logs a compute failure at once when no sink is given', async () => {
    const failure = new Error('engine exploded');
    vi.mocked(computeParcelProfit).mockRejectedValue(failure);

    const result = await computeParcelProfitForRead({
      organizationId: ORG_ID,
      orderId: ORDER_ID,
      surface: 'order-detail',
    });

    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[profit-read] in-request profit computation failed',
      { surface: 'order-detail', organizationId: ORG_ID, orderId: ORDER_ID, err: failure },
    );
  });

  it('stays silent for an unsupported platform with a sink', async () => {
    vi.mocked(computeParcelProfit).mockRejectedValue(new UnsupportedPlatformError('HEPSIBURADA'));
    const sink = makeSink();

    const result = await computeParcelProfitForRead({
      organizationId: ORG_ID,
      orderId: ORDER_ID,
      surface: 'live-performance',
      failures: sink,
    });

    expect(result).toBeNull();
    expect(sink.record).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('stays silent for an unsupported platform without a sink', async () => {
    vi.mocked(computeParcelProfit).mockRejectedValue(new UnsupportedPlatformError('HEPSIBURADA'));

    const result = await computeParcelProfitForRead({
      organizationId: ORG_ID,
      orderId: ORDER_ID,
      surface: 'order-detail',
    });

    expect(result).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
