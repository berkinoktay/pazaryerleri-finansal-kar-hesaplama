import {
  GRID_WORKER_MAX_OLD_GENERATION_MB,
  GRID_WORKER_MAX_YOUNG_GENERATION_MB,
} from '../../src/constants';
import { SpreadsheetFileError } from '../../src/errors';
import { readWorkbookGrid } from '../../src/parse';
import { resolveReadOptions } from '../../src/read-options';
import { buildXlsxFixture, worksheetXml } from '../../src/testing/build-xlsx';
import { createGridWorkerHost, workerLimitReason } from '../../src/worker/grid-worker-host';
import { FIXTURE_PINS, gridSha256, readFixture } from './fixture-pins';
import { numberRows } from './workbooks';

// Run by src/worker/tsx-runtime.test.ts under the real tsx CLI, the way production
// starts the API (`tsx src/index.ts`), outside vitest. Prints one line per step:
//   grid <sha256>   the commission fixture read through readWorkbookGrid (default host)
//   kill <reason>   a run on a host with a 1 ms time limit; each kill respawns its worker
//   kill <reason>   a run on a host with a 128 MB heap, killed for memory
//   grid <sha256>   the fixture read on that SAME host: its worker really respawned
//   grid <sha256>   the fixture read through readWorkbookGrid again
// The process must then exit on its own: an idle worker does not hold it open.

const COMMISSION_FIXTURE = 'trendyol-commission-tariff.xlsx';
const KILLS = 5;
const KILL_TIMEOUT_MS = 1;
// Passes the gate (DOM weight about 4.46 M) but needs about 440 MB of DOM.
const SMALL_HEAP_MB = 128;
const MEMORY_KILL_TIMEOUT_MS = 120_000;
const SMALL_YOUNG_GENERATION_MB = 32;
const OOM_ROWS = 5_000;
const OOM_COLUMNS = 40;

const pin = FIXTURE_PINS.find((p) => p.file === COMMISSION_FIXTURE);
if (pin === undefined) throw new Error(`no pin for ${COMMISSION_FIXTURE}`);
const file = readFixture(pin.file);
const readOptions = { sheetName: pin.sheetName };

function outcomeOf(e: unknown): string {
  if (e instanceof SpreadsheetFileError) return workerLimitReason(e) ?? e.code;
  return String(e);
}

process.stdout.write(`grid ${gridSha256(await readWorkbookGrid(file, readOptions))}\n`);

const killer = createGridWorkerHost({
  maxOldGenerationSizeMb: GRID_WORKER_MAX_OLD_GENERATION_MB,
  maxYoungGenerationSizeMb: GRID_WORKER_MAX_YOUNG_GENERATION_MB,
  timeoutMs: KILL_TIMEOUT_MS,
});
for (let i = 0; i < KILLS; i += 1) {
  const outcome = await killer.run(file, resolveReadOptions(readOptions)).then(
    () => 'answered',
    (e: unknown) => outcomeOf(e),
  );
  process.stdout.write(`kill ${outcome}\n`);
}
await killer.close();

const smallHeap = createGridWorkerHost({
  maxOldGenerationSizeMb: SMALL_HEAP_MB,
  maxYoungGenerationSizeMb: SMALL_YOUNG_GENERATION_MB,
  // Generous, so only memory can kill it, even on a loaded machine.
  timeoutMs: MEMORY_KILL_TIMEOUT_MS,
});
const tooBig = buildXlsxFixture([
  { name: 'Sheet1', xml: worksheetXml(numberRows(OOM_ROWS, OOM_COLUMNS)) },
]);
const memoryOutcome = await smallHeap.run(tooBig, resolveReadOptions({})).then(
  () => 'answered',
  (e: unknown) => outcomeOf(e),
);
process.stdout.write(`kill ${memoryOutcome}\n`);
process.stdout.write(
  `grid ${gridSha256(await smallHeap.run(file, resolveReadOptions(readOptions)))}\n`,
);
await smallHeap.close();

process.stdout.write(`grid ${gridSha256(await readWorkbookGrid(file, readOptions))}\n`);
