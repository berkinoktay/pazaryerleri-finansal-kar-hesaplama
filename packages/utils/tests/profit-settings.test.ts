import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROFIT_SETTINGS,
  resolveProfitSettings,
  resolveSnapshotProfitSettings,
} from '../src/profit-settings';

describe('DEFAULT_PROFIT_SETTINGS', () => {
  it('keeps stopaj included and negative net VAT excluded (matches competitor default)', () => {
    expect(DEFAULT_PROFIT_SETTINGS).toEqual({
      includeStopaj: true,
      includeNegativeNetVat: false,
    });
  });
});

describe('resolveProfitSettings()', () => {
  it('returns defaults for an empty object', () => {
    expect(resolveProfitSettings({})).toEqual(DEFAULT_PROFIT_SETTINGS);
  });

  it('returns defaults for null / undefined / non-object', () => {
    expect(resolveProfitSettings(null)).toEqual(DEFAULT_PROFIT_SETTINGS);
    expect(resolveProfitSettings(undefined)).toEqual(DEFAULT_PROFIT_SETTINGS);
    expect(resolveProfitSettings('nonsense')).toEqual(DEFAULT_PROFIT_SETTINGS);
    expect(resolveProfitSettings(42)).toEqual(DEFAULT_PROFIT_SETTINGS);
  });

  it('reads explicitly provided keys', () => {
    expect(resolveProfitSettings({ includeStopaj: false, includeNegativeNetVat: true })).toEqual({
      includeStopaj: false,
      includeNegativeNetVat: true,
    });
  });

  it('merges a partial object with defaults', () => {
    expect(resolveProfitSettings({ includeStopaj: false })).toEqual({
      includeStopaj: false,
      includeNegativeNetVat: false,
    });
    expect(resolveProfitSettings({ includeNegativeNetVat: true })).toEqual({
      includeStopaj: true,
      includeNegativeNetVat: true,
    });
  });

  it('falls back to defaults for wrong-typed values (defensive against bad JSONB)', () => {
    expect(resolveProfitSettings({ includeStopaj: 'yes', includeNegativeNetVat: 1 })).toEqual(
      DEFAULT_PROFIT_SETTINGS,
    );
  });

  it('returns a fresh object (no shared mutable default reference)', () => {
    const a = resolveProfitSettings({});
    a.includeStopaj = false;
    expect(DEFAULT_PROFIT_SETTINGS.includeStopaj).toBe(true);
  });
});

describe('resolveSnapshotProfitSettings()', () => {
  it('reads non-null snapshot columns verbatim', () => {
    expect(
      resolveSnapshotProfitSettings({
        snapshotIncludeStopaj: false,
        snapshotIncludeNegativeNetVat: true,
      }),
    ).toEqual({ includeStopaj: false, includeNegativeNetVat: true });
  });

  it('falls back to defaults when a snapshot column is null (historical / profit-excluded order)', () => {
    expect(
      resolveSnapshotProfitSettings({
        snapshotIncludeStopaj: null,
        snapshotIncludeNegativeNetVat: null,
      }),
    ).toEqual(DEFAULT_PROFIT_SETTINGS);
  });

  it('resolves each column independently when only one is null', () => {
    expect(
      resolveSnapshotProfitSettings({
        snapshotIncludeStopaj: false,
        snapshotIncludeNegativeNetVat: null,
      }),
    ).toEqual({ includeStopaj: false, includeNegativeNetVat: false });
  });
});
