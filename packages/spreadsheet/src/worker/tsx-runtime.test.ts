import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { FIXTURE_PINS } from '../../tests/helpers/fixture-pins';

// The production loading path: the API runs `tsx src/index.ts`, and the worker loads
// through grid-worker-entry.mjs, which registers tsx itself. Vitest forks do not load
// modules the way tsx does, so this test spawns the real tsx CLI on a probe script
// (tests/helpers/tsx-runtime-probe.ts) and checks what it prints.

const COMMISSION_FIXTURE = 'trendyol-commission-tariff.xlsx';
const KILLS = 5;
const PROBE_TIMEOUT_MS = 60_000;
// Above the probe's own timeout, so a hung probe fails on its exit status.
const TEST_TIMEOUT_MS = 90_000;
const PROBE_PATH = fileURLToPath(
  new URL('../../tests/helpers/tsx-runtime-probe.ts', import.meta.url),
);

function hasStringBin(value: unknown): value is { readonly bin: string } {
  return (
    typeof value === 'object' && value !== null && 'bin' in value && typeof value.bin === 'string'
  );
}

/** The tsx CLI script, resolved from tsx/package.json's `bin`. */
function tsxCliPath(): string {
  const manifestPath = createRequire(import.meta.url).resolve('tsx/package.json');
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!hasStringBin(manifest)) throw new Error('tsx/package.json has no single bin entry');
  return join(dirname(manifestPath), manifest.bin);
}

describe('the grid worker under the tsx CLI', () => {
  it(
    'reads a fixture, survives time and memory kills and reads it again on a respawned worker',
    () => {
      const pin = FIXTURE_PINS.find((p) => p.file === COMMISSION_FIXTURE);
      if (pin === undefined) throw new Error(`no pin for ${COMMISSION_FIXTURE}`);
      const result = spawnSync(process.execPath, [tsxCliPath(), PROBE_PATH], {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
      });

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        `grid ${pin.gridSha256}`,
        ...Array.from({ length: KILLS }, () => 'kill worker-timeout'),
        'kill worker-memory',
        `grid ${pin.gridSha256}`,
        `grid ${pin.gridSha256}`,
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});
