// Read-only audit of the campaign workbooks stored before the stricter upload gate.
//
// For each of the six campaign parent tables it walks the rows that hold a
// `source_file`, one at a time, and reads each file twice through the engine: with
// the selector the page's legacy export service passes today (what the stricter gate
// now refuses) and with the page's strict selector (named sheet, or the first sheet
// by index). Per table it prints the `source_format_id` groups, the count of stored
// files without a format id, the table's total row count next to the number of stored
// files (a run against an empty or wrong database shows its zeros there) and, per
// selector, the files that passed and the refused ones grouped by engine code and
// reason with their record ids. A CORRUPT_FILE whose `meta.rule` names the reader
// rule the file broke (a READER_RULES key) is grouped under `CORRUPT_FILE rule:<rule>`.
// It never prints a file name, a list name, a cell or an engine error message
// (`meta.cause` included): only allowlisted engine reasons and reader rule keys reach
// the output.
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
// It connects with AUDIT_DATABASE_URL and nothing else: it never falls back to
// DATABASE_URL or DIRECT_URL and reads no .env file, so it cannot audit another
// database than the one the operator names. An unset or empty AUDIT_DATABASE_URL is a
// fatal error that names the variable. Before connecting it refuses a URL that is not
// postgres:// or postgresql://, a URL whose authority leaves out the host or the port
// (pg would take them from PGHOST and PGPORT), a URL with a `host`, `hostaddr` or
// `port` query parameter in any letter case (pg reads those in place of the
// authority), and a URL to the transaction pooler (port 6543 in the authority, or
// `pgbouncer=true` in any case): the read-only startup option is not guaranteed to
// reach the server connections behind it. Use the direct connection or the session
// pooler. It prints the `host:port` of the URL and the database name the server
// reports, never the URL or its password.
//
// It runs before and after the migration that adds `source_format_id` (looked up in
// the `public` schema): before it (the deploy order runs it against the live database
// first) the format id lines are skipped. Exit code 1 when a stored file is refused
// with the legacy selector (what the stricter gate changes for an export today), when
// a file is listed as "legacy passed, named sheet unreadable", when a table holds a
// format id other than its expected one, or on a fatal error (an unset
// AUDIT_DATABASE_URL and a refused URL included); 0 otherwise.
//
// Full mode runs after gate mode, once the migration has run, for every table: all six
// pages are on the generic workbook pipeline (FULL_MODE_ADAPTERS; a table without an
// adapter is a fatal error). Per stored file, one at a time, it
// runs the production export path, never a copy of it: the adapter's `load` with the
// row's own organization and store, `resolveStoredWorkbook` (the format by
// `source_format_id` or by selection, the strict sheet read, the layout, the write
// columns), then `readRows` and the import rehearsal (`buildRehearsal` and
// `patchWorkbook`, its output dropped), and `planExport` over the record's items. It
// never calls `exportWorkbook` or `touchExported`: those write. Per table it prints
// the total, the files that passed and, per refusal reason, the count and the record
// ids; a STORED_FILE_UNREADABLE carries the engine code and reason gate mode's strict
// read found for that record. Any full-mode refusal sets exit code 1. The production
// path also logs its own `workbook.stored-file-rejected` lines into the same output
// (page, record id, engine code and engine reason; never a file name or cell content).
// A record can carry two reasons (the rehearsal's and the plan's), so the reason
// counts can add up to more than the refused count.
//
// Usage, once before the migration and once after it:
//   AUDIT_DATABASE_URL='<direct or session connection string>' pnpm --filter @pazarsync/api audit:stored-workbooks

// Type only: a value import would load the package, and build its pool, before main()
// makes DATABASE_URL read-only.
import type { PrismaClient } from '@pazarsync/db';
import { Platform } from '@pazarsync/db/enums';
import {
  MALFORMED_SHEET_REASONS,
  PATCH_LIMIT_REASONS,
  patchWorkbook,
  READER_RULES,
  readWorkbookGrid,
  SpreadsheetFileError,
  UNSAFE_CONTENT_REASONS,
  UNSUPPORTED_ENCODING_REASONS,
  UPLOAD_LIMIT_REASONS,
  WORKER_LIMIT_REASONS,
  ZIP_REJECT_REASONS,
  type LayoutSpec,
  type ReadGridOptions,
  type SpreadsheetFileErrorCode,
} from '@pazarsync/spreadsheet';
import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';

// Types only, for the same reason: every value module under src/ loads @pazarsync/db
// (directly, or through @pazarsync/sync-core), so main() imports them only after
// DATABASE_URL is read-only (loadFullMode).
import type { WorkbookVerticalAdapter } from '../src/workbooks/adapter';
import type { planExport } from '../src/workbooks/export-plan';
import type { resolveStoredWorkbook, StoredWorkbook } from '../src/workbooks/export-workbook';
import type { readRows } from '../src/workbooks/import-rows';
import type { buildRehearsal, rehearsalTargets } from '../src/workbooks/rehearsal';

/** The one variable the audit takes its connection URL from; no other variable stands in. */
const AUDIT_URL_VARIABLE = 'AUDIT_DATABASE_URL';
/** The variable @pazarsync/db builds its pool from. */
const DATABASE_URL_VARIABLE = 'DATABASE_URL';
/** The URL schemes of a Postgres connection string. */
const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(['postgres:', 'postgresql:']);
/**
 * Query parameters pg (or libpq) reads in place of the URL's host or port, compared on
 * the decoded name in any letter case.
 */
const AUTHORITY_OVERRIDE_PARAMS: ReadonlySet<string> = new Set(['host', 'hostaddr', 'port']);
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

// The sheet names the legacy import and export services read (their private SHEET_NAME
// constants; for the pages whose services are gone, the sheet their formats name),
// written with escapes so this file stays ASCII.
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
  ...Object.values(UPLOAD_LIMIT_REASONS),
  ...Object.values(WORKER_LIMIT_REASONS),
  ...Object.values(ZIP_REJECT_REASONS),
]);

/** The reader rule keys CORRUPT_FILE's `meta.rule` may carry; any other value is never printed. */
const KNOWN_READER_RULES: ReadonlySet<string> = new Set(Object.keys(READER_RULES));

const HAS_STORED_FILE = { sourceFile: { not: null } } as const;
const STORED_FILE_WITHOUT_FORMAT = { sourceFile: { not: null }, sourceFormatId: null } as const;
/** A stored record's id and own scope, and its store's platform (for format selection). */
const STORED_RECORD_SELECT = {
  id: true,
  organizationId: true,
  storeId: true,
  store: { select: { platform: true } },
} as const;

/** A parent row that holds a stored file: its id, its own scope and its store's platform. */
interface StoredRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly storeId: string;
  readonly platform: Platform;
}

/** The shape STORED_RECORD_SELECT reads. */
interface StoredRecordRow {
  readonly id: string;
  readonly organizationId: string;
  readonly storeId: string;
  readonly store: { readonly platform: Platform };
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
  /** What the page's legacy export service passes to readWorkbookGrid (passed, once moved). */
  readonly legacyRead: ReadGridOptions;
  /** The strict selector of the page's workbook format. */
  readonly strictRead: ReadGridOptions;
  /** Every row of the table, with or without a stored file. */
  readonly rowCount: () => Promise<number>;
  /** The rows that hold a stored file, by id. */
  readonly storedRecords: () => Promise<readonly StoredRecord[]>;
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

/** What gate mode hands to full mode for one table. */
interface GateResult {
  readonly outcome: TableOutcome;
  /** The rows that held a stored file when gate mode listed them. */
  readonly records: readonly StoredRecord[];
  /** The strict selector's refusal key per refused record id. */
  readonly strictKeyById: ReadonlyMap<string, string>;
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

function recordsOf(rows: readonly StoredRecordRow[]): StoredRecord[] {
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    platform: row.store.platform,
  }));
}

/** The parsed AUDIT_DATABASE_URL; unset, empty or unparsable is fatal, naming the variable only. */
function readAuditUrl(): URL {
  const raw = process.env[AUDIT_URL_VARIABLE];
  if (raw === undefined || raw === '') {
    throw new Error(
      `${AUDIT_URL_VARIABLE} is not set; pass the direct or session connection string in it`,
    );
  }
  try {
    return new URL(raw);
  } catch (err) {
    throw new Error(`${AUDIT_URL_VARIABLE} is not a valid URL`, { cause: err });
  }
}

/**
 * Refuses a URL whose server pg would not take from its authority: another scheme, an
 * empty host or port (pg falls back to PGHOST and PGPORT), or a `host`, `hostaddr` or
 * `port` query parameter in any letter case (pg reads those in place of the authority).
 * The error names the canonical parameter, never its value or the URL.
 */
function assertAuthorityNamesTheServer(url: URL): void {
  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw new Error(`${AUDIT_URL_VARIABLE} is not a postgres:// or postgresql:// URL`);
  }
  if (url.hostname === '' || url.port === '') {
    throw new Error(`${AUDIT_URL_VARIABLE} must name both its host and its port`);
  }
  for (const name of url.searchParams.keys()) {
    const canonical = name.toLowerCase();
    if (AUTHORITY_OVERRIDE_PARAMS.has(canonical)) {
      throw new Error(
        `${AUDIT_URL_VARIABLE} carries the "${canonical}" query parameter, which overrides ` +
          'the host or port of the URL; remove it',
      );
    }
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
function withReadOnlySessions(url: URL): string {
  const target = new URL(url);
  const existing = target.searchParams.get(PG_OPTIONS_PARAM);
  target.searchParams.set(
    PG_OPTIONS_PARAM,
    existing === null ? READ_ONLY_SESSION_OPTION : `${existing} ${READ_ONLY_SESSION_OPTION}`,
  );
  return target.toString();
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
      rowCount: async () => db.commissionTariff.count(),
      storedRecords: async () =>
        recordsOf(
          await db.commissionTariff.findMany({
            where: HAS_STORED_FILE,
            select: STORED_RECORD_SELECT,
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
      rowCount: async () => db.plusCommissionTariff.count(),
      storedRecords: async () =>
        recordsOf(
          await db.plusCommissionTariff.findMany({
            where: HAS_STORED_FILE,
            select: STORED_RECORD_SELECT,
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
      rowCount: async () => db.advantageTariff.count(),
      storedRecords: async () =>
        recordsOf(
          await db.advantageTariff.findMany({
            where: HAS_STORED_FILE,
            select: STORED_RECORD_SELECT,
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
      rowCount: async () => db.flashProductList.count(),
      storedRecords: async () =>
        recordsOf(
          await db.flashProductList.findMany({
            where: HAS_STORED_FILE,
            select: STORED_RECORD_SELECT,
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
      rowCount: async () => db.discountList.count(),
      storedRecords: async () =>
        recordsOf(
          await db.discountList.findMany({
            where: HAS_STORED_FILE,
            select: STORED_RECORD_SELECT,
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
      rowCount: async () => db.marketplaceCampaignList.count(),
      storedRecords: async () =>
        recordsOf(
          await db.marketplaceCampaignList.findMany({
            where: HAS_STORED_FILE,
            select: STORED_RECORD_SELECT,
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

/** Record id to its refusal key, from a tally keyed by refusal. */
function keyById(groups: IdGroups): Map<string, string> {
  const byId = new Map<string, string>();
  for (const [key, ids] of groups) for (const id of ids) byId.set(id, key);
  return byId;
}

async function auditTable(
  table: StoredWorkbookTable,
  withFormatColumn: boolean,
): Promise<GateResult> {
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

  const rows = await table.rowCount();
  const records = await table.storedRecords();
  const legacy = createTally();
  const strict = createTally();
  // Keyed by the strict refusal key.
  const namedSheetUnreadable: IdGroups = new Map();
  let gone = 0;
  // One file at a time: each holds the single parse worker for two reads.
  for (const { id } of records) {
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

  console.log(`  rows: ${rows}, stored files: ${records.length}, gone during the run: ${gone}`);
  printTally('legacy selector', legacy);
  printTally('strict selector', strict);
  const unreadable = idCount(namedSheetUnreadable);
  console.log(`  legacy passed, named sheet unreadable: ${unreadable}`);
  printGroups(namedSheetUnreadable);
  return {
    outcome: {
      legacyRefused: idCount(legacy.refusals),
      namedSheetUnreadable: unreadable,
      unexpectedFormatIds: unexpected,
    },
    records,
    strictKeyById: keyById(strict.refusals),
  };
}

// --- Full mode: the generic export path on every stored file of a moved page ---------

/** The production functions full mode runs, imported after DATABASE_URL is read-only. */
interface FullModeEngine {
  readonly resolveStoredWorkbook: typeof resolveStoredWorkbook;
  readonly readRows: typeof readRows;
  readonly rehearsalTargets: typeof rehearsalTargets;
  readonly buildRehearsal: typeof buildRehearsal;
  readonly planExport: typeof planExport;
  /** The `reason` of a WorkbookConflictError, else null. */
  readonly conflictReason: (err: unknown) => string | null;
  /** The `code` of a WorkbookFileRejection, else null. */
  readonly fileRejectionCode: (err: unknown) => string | null;
}

/** Full mode for one page's table: the refusal keys of one stored record, or null when it is gone. */
interface RecordAuditor {
  readonly table: string;
  readonly audit: (
    record: StoredRecord,
    strictKey: string | null,
  ) => Promise<readonly string[] | null>;
}

const STORED_FILE_UNREADABLE_REASON = 'STORED_FILE_UNREADABLE';
const STRICT_READ_PASSED = 'passed';
const ROWS_STAGE = 'rows';
const REHEARSAL_STAGE = 'rehearsal';

/** The report key of an error of the generic path: its conflict reason, file code or engine key. */
function pipelineKey(engine: FullModeEngine, err: unknown): string {
  return engine.conflictReason(err) ?? engine.fileRejectionCode(err) ?? refusalOf(err).key;
}

/**
 * The key of a `resolveStoredWorkbook` refusal. Its STORED_FILE_UNREADABLE hides the
 * engine code, so the key carries what gate mode's strict read found for the record.
 * When that read passed (the refusal came later, e.g. MALFORMED_SHEET from the write
 * columns), the engine code is in the `workbook.stored-file-rejected` line that
 * `toStoredFileError` printed just before.
 */
function storedFileKey(engine: FullModeEngine, err: unknown, strictKey: string | null): string {
  const key = pipelineKey(engine, err);
  if (key !== STORED_FILE_UNREADABLE_REASON) return key;
  return `${key} (strict read: ${strictKey ?? STRICT_READ_PASSED})`;
}

/** The import rehearsal on the stored file: `readRows`, `buildRehearsal`, `patchWorkbook` (dropped). */
async function rehearsalRefusal<S extends LayoutSpec, TRow, TWrite extends string>(
  engine: FullModeEngine,
  align: 'anchor-map' | 'cursor-zip',
  stored: StoredWorkbook<S, TRow, TWrite>,
  file: Buffer,
): Promise<string | null> {
  let rehearsal;
  try {
    const read = engine.readRows(stored);
    rehearsal = engine.buildRehearsal(
      stored,
      engine.rehearsalTargets(align, read),
      stored.resolved,
    );
  } catch (err) {
    return `${ROWS_STAGE} ${pipelineKey(engine, err)}`;
  }
  if (rehearsal.patches.length === 0) return null;
  try {
    await patchWorkbook(file, {
      sheet: stored.format.sheet,
      anchors: rehearsal.anchors,
      outputs: [rehearsal.patches],
      overwriteFormulaColumns: rehearsal.overwriteFormulaColumns,
    });
    return null;
  } catch (err) {
    return `${REHEARSAL_STAGE} ${refusalOf(err).key}`;
  }
}

/**
 * Full mode for one adapter. Per record: `load` with the record's own scope, then
 * `resolveStoredWorkbook`; when that passes, the rehearsal and `planExport` each add
 * their refusal. Nothing here writes.
 */
function recordAuditor<
  S extends LayoutSpec,
  TRow,
  TConfig,
  TMeta,
  TItem,
  TResponse,
  TWrite extends string,
>(
  engine: FullModeEngine,
  adapter: WorkbookVerticalAdapter<S, TRow, TConfig, TMeta, TItem, TResponse, TWrite>,
): RecordAuditor {
  return {
    table: adapter.parentTable,
    audit: async (record, strictKey) => {
      const scope = { organizationId: record.organizationId, storeId: record.storeId };
      const source = await adapter.load(scope, record.id);
      if (source === null || source.sourceFile === null) return null;
      const file = Buffer.from(source.sourceFile);

      let stored: StoredWorkbook<S, TRow, TWrite>;
      try {
        stored = await engine.resolveStoredWorkbook({
          page: adapter.page,
          formats: adapter.formats,
          file,
          sourceFormatId: source.sourceFormatId,
          platform: record.platform,
          recordId: record.id,
        });
      } catch (err) {
        return [storedFileKey(engine, err, strictKey)];
      }

      const refusals: string[] = [];
      const rehearsal = await rehearsalRefusal(engine, adapter.align, stored, file);
      if (rehearsal !== null) refusals.push(rehearsal);
      try {
        engine.planExport({ ...stored, groups: source.groups, adapter });
      } catch (err) {
        refusals.push(pipelineKey(engine, err));
      }
      return refusals;
    },
  };
}

/**
 * The production modules full mode runs, and one auditor per page on the generic
 * pipeline. Imported only now, like @pazarsync/db in main(): each of them loads
 * @pazarsync/db (directly, or through @pazarsync/sync-core), whose pool is built from
 * DATABASE_URL when it loads. A static import would build that pool from whatever
 * DATABASE_URL held before main() made it read-only, and break the read-only guarantee.
 */
async function loadFullMode(): Promise<readonly RecordAuditor[]> {
  const [
    exportWorkbook,
    exportPlan,
    importRows,
    rehearsal,
    errors,
    workbookErrors,
    discount,
    campaign,
    flash,
    advantage,
    plus,
    commission,
  ] = await Promise.all([
    import('../src/workbooks/export-workbook'),
    import('../src/workbooks/export-plan'),
    import('../src/workbooks/import-rows'),
    import('../src/workbooks/rehearsal'),
    import('../src/lib/errors'),
    import('../src/workbooks/workbook-errors'),
    import('../src/workbooks/verticals/discount-list.adapter'),
    import('../src/workbooks/verticals/marketplace-campaign-list.adapter'),
    import('../src/workbooks/verticals/flash-product-list.adapter'),
    import('../src/workbooks/verticals/advantage-tariff.adapter'),
    import('../src/workbooks/verticals/plus-commission-tariff.adapter'),
    import('../src/workbooks/verticals/commission-tariff.adapter'),
  ]);
  const engine: FullModeEngine = {
    resolveStoredWorkbook: exportWorkbook.resolveStoredWorkbook,
    readRows: importRows.readRows,
    rehearsalTargets: rehearsal.rehearsalTargets,
    buildRehearsal: rehearsal.buildRehearsal,
    planExport: exportPlan.planExport,
    conflictReason: (err) => (err instanceof errors.WorkbookConflictError ? err.reason : null),
    fileRejectionCode: (err) =>
      err instanceof workbookErrors.WorkbookFileRejection ? err.code : null,
  };
  // FULL_MODE_ADAPTERS: each vertical appends its adapter as it moves.
  return [
    recordAuditor(engine, discount.discountListAdapter),
    recordAuditor(engine, campaign.marketplaceCampaignListAdapter),
    recordAuditor(engine, flash.flashProductListAdapter),
    recordAuditor(engine, advantage.advantageTariffAdapter),
    recordAuditor(engine, plus.plusCommissionTariffAdapter),
    recordAuditor(engine, commission.commissionTariffAdapter),
  ];
}

/** Full mode over one table's stored records, one file at a time; returns the refused count. */
async function auditTableFullMode(auditor: RecordAuditor, gate: GateResult): Promise<number> {
  const refusals: IdGroups = new Map();
  let passed = 0;
  let refused = 0;
  let gone = 0;
  for (const record of gate.records) {
    const keys = await auditor.audit(record, gate.strictKeyById.get(record.id) ?? null);
    if (keys === null) {
      gone += 1;
      continue;
    }
    if (keys.length === 0) {
      passed += 1;
      continue;
    }
    refused += 1;
    for (const key of keys) addId(refusals, key, record.id);
  }
  console.log(
    `${auditor.table} full mode: total ${gate.records.length}, passed ${passed}, ` +
      `refused ${refused}, gone during the run ${gone}`,
  );
  printGroups(refusals);
  return refused;
}

async function main(): Promise<void> {
  // Every check runs on this one parsed URL, and the pool's URL is built from it.
  const url = readAuditUrl();
  assertAuthorityNamesTheServer(url);
  if (isTransactionPoolerUrl(url)) {
    throw new Error(
      `${AUDIT_URL_VARIABLE} points at the transaction pooler (port ${TRANSACTION_POOLER_PORT} ` +
        `or ${PGBOUNCER_PARAM}=${PGBOUNCER_ON}), which does not guarantee the read-only session; ` +
        'use the direct connection or the session pooler',
    );
  }
  process.env[DATABASE_URL_VARIABLE] = withReadOnlySessions(url);
  // Imported only now: the package builds its pool from DATABASE_URL when it loads.
  const { prisma } = await import('@pazarsync/db');
  try {
    const dbName = await confirmReadOnly(prisma);
    console.log(
      `database ${dbName} on ${url.hostname}:${url.port} (from ${AUDIT_URL_VARIABLE}): ` +
        'read-only session',
    );
    const withFormatColumn = await hasSourceFormatColumn(prisma);
    let failed = false;
    const gates = new Map<string, GateResult>();
    for (const table of storedWorkbookTables(prisma)) {
      const gate = await auditTable(table, withFormatColumn);
      gates.set(table.table, gate);
      const { outcome } = gate;
      if (
        outcome.legacyRefused > 0 ||
        outcome.namedSheetUnreadable > 0 ||
        outcome.unexpectedFormatIds > 0
      ) {
        failed = true;
      }
    }

    if (withFormatColumn) {
      const auditors = await loadFullMode();
      for (const [table, gate] of gates) {
        const auditor = auditors.find((candidate) => candidate.table === table);
        // Every page is on the generic pipeline, so a table without an auditor is a bug
        // in this script, never a page that has not moved yet.
        if (auditor === undefined) throw new Error(`${table} has no full-mode auditor`);
        if ((await auditTableFullMode(auditor, gate)) > 0) failed = true;
      }
    } else {
      console.log('full mode: skipped (source_format_id column absent)');
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
