// Read-only audit of the campaign workbooks stored before the stricter upload gate.
//
// For each of the six campaign parent tables it walks the rows that hold a
// `source_file`, one at a time, and reads each file twice through the engine: with
// the selector the page's legacy export service passes today (what the stricter gate
// now refuses) and with the page's strict selector (named sheet, or the first sheet
// by index). Per table it prints the `source_format_id` groups, the count of stored
// files without a format id, the number of stored files and, per selector, the files
// that passed and the refused ones grouped by engine code and reason with their
// record ids. A CORRUPT_FILE whose `meta.rule` names the reader rule the file broke
// (a READER_RULES key) is grouped as `CORRUPT_FILE rule:<rule>`. It never prints a
// file name, a list name, a cell or an engine error message (`meta.cause` included):
// only allowlisted engine reasons and reader rule keys reach the output.
//
// A file the legacy selector reads while the strict selector refuses it as
// CORRUPT_FILE was read through the legacy fallback to the first sheet: its named
// sheet cannot be read. Per table such files are listed again as "legacy passed,
// named sheet unreadable", grouped by their strict refusal key. A strict
// SHEET_NOT_FOUND alone is reported in the strict selector's tally only.
//
// It reads every tenant's rows on purpose: it is an operator tool, not a request
// path, so no organization scope applies. It cannot write: every session of the pool
// it queries through starts with `default_transaction_read_only=on`, and it stops
// before reading a row unless the database confirms the session is read-only.
//
// It connects with DIRECT_URL, else DATABASE_URL (an empty value counts as unset),
// and prints only the `host:port` of that URL and which variable it came from. Before
// connecting it refuses a URL to the transaction pooler (port 6543, or `pgbouncer=true`
// in any case): the read-only startup option is not guaranteed to reach the server
// connections behind it. Use the direct connection or the session pooler.
//
// It runs before and after the migration that adds `source_format_id` (looked up in
// the `public` schema): before it (the deploy order runs it against the live database
// first) the format id lines are skipped. Exit code 1 when a stored file is refused
// with the legacy selector (what the stricter gate changes for an export today), when
// a file is listed as "legacy passed, named sheet unreadable", when a table holds a
// format id other than its expected one, or on a fatal error (a pooler URL included);
// 0 otherwise.
//
// Usage (DIRECT_URL or DATABASE_URL from the environment, else from the repo-root .env):
//   pnpm --filter @pazarsync/api audit:stored-workbooks

// Type only: a value import would load the package, and build its pool, before main()
// makes DATABASE_URL read-only.
import type { PrismaClient } from '@pazarsync/db';
import { Platform } from '@pazarsync/db/enums';
import {
  MALFORMED_SHEET_REASONS,
  PATCH_LIMIT_REASONS,
  READER_RULES,
  readWorkbookGrid,
  SpreadsheetFileError,
  UNSAFE_CONTENT_REASONS,
  UNSUPPORTED_ENCODING_REASONS,
  WORKER_LIMIT_REASONS,
  ZIP_REJECT_REASONS,
  type ReadGridOptions,
  type SpreadsheetFileErrorCode,
} from '@pazarsync/spreadsheet';
import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';

/** The variable @pazarsync/db builds its pool from. */
const DATABASE_URL_VARIABLE = 'DATABASE_URL';
/** Where the connection URL comes from, in this order: the direct connection first. */
const CONNECTION_URL_VARIABLES = ['DIRECT_URL', DATABASE_URL_VARIABLE] as const;
/** The port of Supabase's transaction pooler. */
const TRANSACTION_POOLER_PORT = '6543';
/** The query parameter that marks a pgbouncer (transaction pooler) URL, compared in any case. */
const PGBOUNCER_PARAM = 'pgbouncer';
const PGBOUNCER_ON = 'true';

/** The libpq startup parameter that carries server settings for the session. */
const PG_OPTIONS_PARAM = 'options';
/** Makes every transaction of the session read-only unless it asks otherwise. */
const READ_ONLY_SESSION_OPTION = '-c default_transaction_read_only=on';
const READ_ONLY_SETTING_ON = 'on';

const SOURCE_FORMAT_VERSION = 'v1';
const NULL_FORMAT_LABEL = 'NULL';
const NO_ROWS_LABEL = '(no rows)';
const FIRST_SHEET_INDEX = 0;
/** The six parent tables gain `source_format_id` in one migration. */
const PARENT_TABLE_COUNT = 6;

const CORRUPT_FILE_CODE: SpreadsheetFileErrorCode = 'CORRUPT_FILE';
const READER_RULE_PREFIX = 'rule:';

// The sheet names the legacy import and export services read today (their private
// SHEET_NAME constants and DISCOUNT_SHEET_NAME), written with escapes so this file
// stays ASCII.
const COMMISSION_TARIFF_SHEET = 'KomisyonTarifeleri\u00dcr\u00fcnleri';
const PLUS_COMMISSION_TARIFF_SHEET = 'TyPlus\u00dcr\u00fcnleri';
const ADVANTAGE_TARIFF_SHEET = 'Y\u0131ld\u0131zl\u0131\u00dcr\u00fcnEtiketleri';
const FLASH_PRODUCT_LIST_SHEET = 'Teklif\u00dcr\u00fcnleri';
const DISCOUNT_LIST_SHEET = '\u00dcr\u00fcnler';

/** Engine reasons that name a rule; any other `meta` value is never printed. */
const KNOWN_REASONS: ReadonlySet<string> = new Set([
  ...Object.values(MALFORMED_SHEET_REASONS),
  ...Object.values(PATCH_LIMIT_REASONS),
  ...Object.values(UNSAFE_CONTENT_REASONS),
  ...Object.values(UNSUPPORTED_ENCODING_REASONS),
  ...Object.values(WORKER_LIMIT_REASONS),
  ...Object.values(ZIP_REJECT_REASONS),
]);

/** The reader rule keys CORRUPT_FILE's `meta.rule` may carry; any other value is never printed. */
const KNOWN_READER_RULES: ReadonlySet<string> = new Set(Object.keys(READER_RULES));

const HAS_STORED_FILE = { sourceFile: { not: null } } as const;
const STORED_FILE_WITHOUT_FORMAT = { sourceFile: { not: null }, sourceFormatId: null } as const;

type ConnectionUrlVariable = (typeof CONNECTION_URL_VARIABLES)[number];

/** The connection URL the audit uses and the variable it came from. */
interface ConnectionUrl {
  readonly url: string;
  readonly variable: ConnectionUrlVariable;
}

/** One row of `GROUP BY source_format_id` over a whole table. */
interface FormatGroupRow {
  readonly sourceFormatId: string | null;
  readonly _count: { readonly _all: number };
}

interface StoredWorkbookTable {
  /** The SQL table name; the report names tables and record ids, never row content. */
  readonly table: string;
  readonly page: WorkbookPage;
  /** What the page's legacy export service passes to readWorkbookGrid today. */
  readonly legacyRead: ReadGridOptions;
  /** The strict selector of the page's workbook format. */
  readonly strictRead: ReadGridOptions;
  readonly storedFileIds: () => Promise<string[]>;
  readonly storedFile: (id: string) => Promise<Uint8Array | null>;
  /** Each binds the groupBy result to a local: a contextual return type derails its inference. */
  readonly formatGroups: () => Promise<readonly FormatGroupRow[]>;
  readonly storedFilesWithoutFormat: () => Promise<number>;
}

/** What one table's audit found that fails the run. */
interface TableOutcome {
  readonly legacyRefused: number;
  readonly namedSheetUnreadable: number;
  readonly unexpectedFormatIds: number;
}

/** Record ids keyed by a report key (`CODE`, `CODE reason` or `CODE rule:<rule>`). */
type IdGroups = Map<string, string[]>;

interface ReadTally {
  passed: number;
  readonly refusals: IdGroups;
}

/** Why one read refused a file: its report key, and the engine code (null when not the engine's). */
interface Refusal {
  readonly key: string;
  readonly code: SpreadsheetFileErrorCode | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sourceFormatId(page: WorkbookPage): string {
  return `${Platform.TRENDYOL}:${page}:${SOURCE_FORMAT_VERSION}`;
}

function idsOf(rows: readonly { readonly id: string }[]): string[] {
  return rows.map((row) => row.id);
}

/** DIRECT_URL, else DATABASE_URL, with the variable it came from; an empty value counts as unset. */
function chooseConnectionUrl(): ConnectionUrl {
  for (const variable of CONNECTION_URL_VARIABLES) {
    const url = process.env[variable];
    if (url !== undefined && url !== '') return { url, variable };
  }
  throw new Error(`Neither ${CONNECTION_URL_VARIABLES.join(' nor ')} is set`);
}

/** The parsed connection URL; a URL that does not parse is named by its variable only. */
function parseConnectionUrl(connection: ConnectionUrl): URL {
  try {
    return new URL(connection.url);
  } catch (err) {
    throw new Error(`${connection.variable} is not a valid URL`, { cause: err });
  }
}

/** Whether `url` goes through the transaction pooler: port 6543, or `pgbouncer=true` in any case. */
function isTransactionPoolerUrl(url: URL): boolean {
  if (url.port === TRANSACTION_POOLER_PORT) return true;
  for (const [name, value] of url.searchParams) {
    if (name.toLowerCase() === PGBOUNCER_PARAM && value.toLowerCase() === PGBOUNCER_ON) {
      return true;
    }
  }
  return false;
}

/** `url` with the read-only session option added to the startup options it may carry. */
function withReadOnlySessions(url: string): string {
  const parsed = new URL(url);
  const existing = parsed.searchParams.get(PG_OPTIONS_PARAM);
  parsed.searchParams.set(
    PG_OPTIONS_PARAM,
    existing === null ? READ_ONLY_SESSION_OPTION : `${existing} ${READ_ONLY_SESSION_OPTION}`,
  );
  return parsed.toString();
}

/** The database name, once the server confirms the session's transactions are read-only. */
async function confirmReadOnly(db: PrismaClient): Promise<string> {
  const rows: unknown =
    await db.$queryRaw`SELECT current_setting('transaction_read_only') AS read_only, current_database() AS db_name`;
  const first: unknown = Array.isArray(rows) ? rows[0] : undefined;
  if (!isRecord(first) || first['read_only'] !== READ_ONLY_SETTING_ON) {
    throw new Error('The session is not read-only; refusing to read stored files');
  }
  const dbName = first['db_name'];
  if (typeof dbName !== 'string') {
    throw new Error('The server did not report the database name');
  }
  return dbName;
}

/**
 * Whether the migration that adds `source_format_id` to the six parent tables of the
 * `public` schema has run. The table names are static SQL text; nothing comes from a
 * variable.
 */
async function hasSourceFormatColumn(db: PrismaClient): Promise<boolean> {
  const rows: unknown = await db.$queryRaw`
    SELECT count(*)::int AS columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'source_format_id'
      AND table_name IN (
        'commission_tariffs', 'plus_commission_tariffs', 'advantage_tariffs',
        'flash_product_lists', 'discount_lists', 'marketplace_campaign_lists'
      )`;
  const first: unknown = Array.isArray(rows) ? rows[0] : undefined;
  const columns = isRecord(first) ? first['columns'] : undefined;
  if (typeof columns !== 'number') {
    throw new Error('The server did not report the source_format_id columns');
  }
  if (columns !== 0 && columns !== PARENT_TABLE_COUNT) {
    throw new Error(`source_format_id exists on ${columns} of ${PARENT_TABLE_COUNT} tables`);
  }
  return columns === PARENT_TABLE_COUNT;
}

function storedWorkbookTables(db: PrismaClient): readonly StoredWorkbookTable[] {
  return [
    {
      table: 'commission_tariffs',
      page: WORKBOOK_PAGES.COMMISSION_TARIFF,
      legacyRead: { sheetName: COMMISSION_TARIFF_SHEET },
      strictRead: { sheet: { by: 'name', name: COMMISSION_TARIFF_SHEET } },
      storedFileIds: async () =>
        idsOf(
          await db.commissionTariff.findMany({
            where: HAS_STORED_FILE,
            select: { id: true },
            orderBy: { id: 'asc' },
          }),
        ),
      storedFile: async (id) =>
        (await db.commissionTariff.findUnique({ where: { id }, select: { sourceFile: true } }))
          ?.sourceFile ?? null,
      formatGroups: async () => {
        const rows = await db.commissionTariff.groupBy({
          by: ['sourceFormatId'],
          _count: { _all: true },
        });
        return rows;
      },
      storedFilesWithoutFormat: async () =>
        db.commissionTariff.count({ where: STORED_FILE_WITHOUT_FORMAT }),
    },
    {
      table: 'plus_commission_tariffs',
      page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
      legacyRead: { sheetName: PLUS_COMMISSION_TARIFF_SHEET },
      strictRead: { sheet: { by: 'name', name: PLUS_COMMISSION_TARIFF_SHEET } },
      storedFileIds: async () =>
        idsOf(
          await db.plusCommissionTariff.findMany({
            where: HAS_STORED_FILE,
            select: { id: true },
            orderBy: { id: 'asc' },
          }),
        ),
      storedFile: async (id) =>
        (await db.plusCommissionTariff.findUnique({ where: { id }, select: { sourceFile: true } }))
          ?.sourceFile ?? null,
      formatGroups: async () => {
        const rows = await db.plusCommissionTariff.groupBy({
          by: ['sourceFormatId'],
          _count: { _all: true },
        });
        return rows;
      },
      storedFilesWithoutFormat: async () =>
        db.plusCommissionTariff.count({ where: STORED_FILE_WITHOUT_FORMAT }),
    },
    {
      table: 'advantage_tariffs',
      page: WORKBOOK_PAGES.ADVANTAGE_TARIFF,
      legacyRead: { sheetName: ADVANTAGE_TARIFF_SHEET },
      strictRead: { sheet: { by: 'name', name: ADVANTAGE_TARIFF_SHEET } },
      storedFileIds: async () =>
        idsOf(
          await db.advantageTariff.findMany({
            where: HAS_STORED_FILE,
            select: { id: true },
            orderBy: { id: 'asc' },
          }),
        ),
      storedFile: async (id) =>
        (await db.advantageTariff.findUnique({ where: { id }, select: { sourceFile: true } }))
          ?.sourceFile ?? null,
      formatGroups: async () => {
        const rows = await db.advantageTariff.groupBy({
          by: ['sourceFormatId'],
          _count: { _all: true },
        });
        return rows;
      },
      storedFilesWithoutFormat: async () =>
        db.advantageTariff.count({ where: STORED_FILE_WITHOUT_FORMAT }),
    },
    {
      table: 'flash_product_lists',
      page: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
      legacyRead: { sheetName: FLASH_PRODUCT_LIST_SHEET },
      strictRead: { sheet: { by: 'name', name: FLASH_PRODUCT_LIST_SHEET } },
      storedFileIds: async () =>
        idsOf(
          await db.flashProductList.findMany({
            where: HAS_STORED_FILE,
            select: { id: true },
            orderBy: { id: 'asc' },
          }),
        ),
      storedFile: async (id) =>
        (await db.flashProductList.findUnique({ where: { id }, select: { sourceFile: true } }))
          ?.sourceFile ?? null,
      formatGroups: async () => {
        const rows = await db.flashProductList.groupBy({
          by: ['sourceFormatId'],
          _count: { _all: true },
        });
        return rows;
      },
      storedFilesWithoutFormat: async () =>
        db.flashProductList.count({ where: STORED_FILE_WITHOUT_FORMAT }),
    },
    {
      table: 'discount_lists',
      page: WORKBOOK_PAGES.DISCOUNT_LIST,
      legacyRead: { sheetName: DISCOUNT_LIST_SHEET },
      strictRead: { sheet: { by: 'name', name: DISCOUNT_LIST_SHEET } },
      storedFileIds: async () =>
        idsOf(
          await db.discountList.findMany({
            where: HAS_STORED_FILE,
            select: { id: true },
            orderBy: { id: 'asc' },
          }),
        ),
      storedFile: async (id) =>
        (await db.discountList.findUnique({ where: { id }, select: { sourceFile: true } }))
          ?.sourceFile ?? null,
      formatGroups: async () => {
        const rows = await db.discountList.groupBy({
          by: ['sourceFormatId'],
          _count: { _all: true },
        });
        return rows;
      },
      storedFilesWithoutFormat: async () =>
        db.discountList.count({ where: STORED_FILE_WITHOUT_FORMAT }),
    },
    {
      // The sheet name changes per campaign, so the legacy services read the first sheet.
      table: 'marketplace_campaign_lists',
      page: WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
      legacyRead: {},
      strictRead: { sheet: { by: 'index', index: FIRST_SHEET_INDEX } },
      storedFileIds: async () =>
        idsOf(
          await db.marketplaceCampaignList.findMany({
            where: HAS_STORED_FILE,
            select: { id: true },
            orderBy: { id: 'asc' },
          }),
        ),
      storedFile: async (id) =>
        (
          await db.marketplaceCampaignList.findUnique({
            where: { id },
            select: { sourceFile: true },
          })
        )?.sourceFile ?? null,
      formatGroups: async () => {
        const rows = await db.marketplaceCampaignList.groupBy({
          by: ['sourceFormatId'],
          _count: { _all: true },
        });
        return rows;
      },
      storedFilesWithoutFormat: async () =>
        db.marketplaceCampaignList.count({ where: STORED_FILE_WITHOUT_FORMAT }),
    },
  ];
}

/**
 * The report key of an engine refusal: `CORRUPT_FILE rule:<rule>` when the engine
 * names a known reader rule, else `CODE reason` with the reason only when it is a
 * known rule name. `meta.cause` is never read.
 */
function refusalKey(err: SpreadsheetFileError): string {
  const rule = err.meta['rule'];
  if (err.code === CORRUPT_FILE_CODE && typeof rule === 'string' && KNOWN_READER_RULES.has(rule)) {
    return `${err.code} ${READER_RULE_PREFIX}${rule}`;
  }
  const reason = err.meta['reason'];
  return typeof reason === 'string' && KNOWN_REASONS.has(reason)
    ? `${err.code} ${reason}`
    : err.code;
}

function refusalOf(err: unknown): Refusal {
  if (!(err instanceof SpreadsheetFileError)) {
    return { key: `UNEXPECTED ${err instanceof Error ? err.name : typeof err}`, code: null };
  }
  return { key: refusalKey(err), code: err.code };
}

function addId(groups: IdGroups, key: string, id: string): void {
  const ids = groups.get(key) ?? [];
  ids.push(id);
  groups.set(key, ids);
}

function idCount(groups: IdGroups): number {
  return [...groups.values()].reduce((sum, ids) => sum + ids.length, 0);
}

function printGroups(groups: IdGroups): void {
  const entries = [...groups].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, ids] of entries) {
    console.log(`    ${key}: ${ids.length} [${ids.join(', ')}]`);
  }
}

function createTally(): ReadTally {
  return { passed: 0, refusals: new Map() };
}

/** Reads `file` once with `options`, records the outcome under `id`, and returns the refusal (null when it passed). */
async function readInto(
  tally: ReadTally,
  id: string,
  file: Buffer,
  options: ReadGridOptions,
): Promise<Refusal | null> {
  try {
    await readWorkbookGrid(file, options);
    tally.passed += 1;
    return null;
  } catch (err) {
    const refusal = refusalOf(err);
    addId(tally.refusals, refusal.key, id);
    return refusal;
  }
}

function formatGroupsText(rows: readonly FormatGroupRow[]): string {
  if (rows.length === 0) return NO_ROWS_LABEL;
  return rows
    .map((row) => `${row.sourceFormatId ?? NULL_FORMAT_LABEL}=${row._count._all}`)
    .sort()
    .join(', ');
}

function printTally(label: string, tally: ReadTally): void {
  console.log(`  ${label}: passed ${tally.passed}, refused ${idCount(tally.refusals)}`);
  printGroups(tally.refusals);
}

/** Format id groups other than NULL and the table's expected id. */
function unexpectedFormatIds(rows: readonly FormatGroupRow[], expected: string): number {
  return rows.filter((row) => row.sourceFormatId !== null && row.sourceFormatId !== expected)
    .length;
}

async function auditTable(
  table: StoredWorkbookTable,
  withFormatColumn: boolean,
): Promise<TableOutcome> {
  const expected = sourceFormatId(table.page);
  console.log(`${table.table} (expected ${expected})`);
  let unexpected = 0;
  if (withFormatColumn) {
    const groups = await table.formatGroups();
    unexpected = unexpectedFormatIds(groups, expected);
    console.log(`  source_format_id groups: ${formatGroupsText(groups)}`);
    console.log(
      `  stored files without source_format_id: ${await table.storedFilesWithoutFormat()}`,
    );
  } else {
    console.log('  source_format_id: column absent (migration not applied yet)');
  }

  const ids = await table.storedFileIds();
  const legacy = createTally();
  const strict = createTally();
  // Keyed by the strict refusal key.
  const namedSheetUnreadable: IdGroups = new Map();
  let gone = 0;
  // One file at a time: each holds the single parse worker for two reads.
  for (const id of ids) {
    const stored = await table.storedFile(id);
    if (stored === null) {
      gone += 1;
      continue;
    }
    const file = Buffer.from(stored);
    const legacyRefusal = await readInto(legacy, id, file, table.legacyRead);
    const strictRefusal = await readInto(strict, id, file, table.strictRead);
    // The legacy read passed through its fallback to the first sheet.
    if (legacyRefusal === null && strictRefusal?.code === CORRUPT_FILE_CODE) {
      addId(namedSheetUnreadable, strictRefusal.key, id);
    }
  }

  console.log(`  stored files: ${ids.length}, gone during the run: ${gone}`);
  printTally('legacy selector', legacy);
  printTally('strict selector', strict);
  const unreadable = idCount(namedSheetUnreadable);
  console.log(`  legacy passed, named sheet unreadable: ${unreadable}`);
  printGroups(namedSheetUnreadable);
  return {
    legacyRefused: idCount(legacy.refusals),
    namedSheetUnreadable: unreadable,
    unexpectedFormatIds: unexpected,
  };
}

async function main(): Promise<void> {
  const connection = chooseConnectionUrl();
  const parsed = parseConnectionUrl(connection);
  if (isTransactionPoolerUrl(parsed)) {
    throw new Error(
      `${connection.variable} points at the transaction pooler (port ${TRANSACTION_POOLER_PORT} ` +
        `or ${PGBOUNCER_PARAM}=${PGBOUNCER_ON}), which does not guarantee the read-only session; ` +
        'use the direct connection or the session pooler',
    );
  }
  process.env[DATABASE_URL_VARIABLE] = withReadOnlySessions(connection.url);
  // Imported only now: the package builds its pool from DATABASE_URL when it loads.
  const { prisma } = await import('@pazarsync/db');
  try {
    const dbName = await confirmReadOnly(prisma);
    console.log(
      `database ${dbName} on ${parsed.host} (from ${connection.variable}): read-only session`,
    );
    const withFormatColumn = await hasSourceFormatColumn(prisma);
    let failed = false;
    for (const table of storedWorkbookTables(prisma)) {
      const outcome = await auditTable(table, withFormatColumn);
      if (
        outcome.legacyRefused > 0 ||
        outcome.namedSheetUnreadable > 0 ||
        outcome.unexpectedFormatIds > 0
      ) {
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (err) {
  console.error(
    `audit-stored-workbooks failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
}
