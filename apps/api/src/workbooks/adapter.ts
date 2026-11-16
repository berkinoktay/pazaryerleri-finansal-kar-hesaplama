// The contract between the generic workbook pipeline and one campaign page (a
// "vertical"). The format files say what a marketplace file looks like; an adapter
// holds what a page cannot express as data: its form, its pre-import checks, how it
// writes its rows, how it loads a list back for export and what each cell of the
// export holds. The generic import and export never know which page they run for.

import type { z } from '@hono/zod-openapi';

import type { Prisma } from '@pazarsync/db';
import type { LayoutSpec, RowReader } from '@pazarsync/spreadsheet';
import type { WorkbookFileCode, WorkbookPage } from '@pazarsync/utils';

import type { WorkbookFormat, WorkbookFormatId } from './format';
import type { WorkbookParentTable } from './upload-quota';

/** The tenant a workbook operation runs for, taken from the verified store record. */
export interface StoreScope {
  readonly organizationId: string;
  readonly storeId: string;
}

/** One kept data row of an upload: its 1-based sheet row, its anchor text, its mapped data. */
export interface ImportedRow<TRow> {
  readonly excelRow: number;
  readonly anchor: string;
  readonly data: TRow;
}

/** The fields every parent row (the list or tariff) of an import is written with. */
export interface ParentFields {
  readonly organizationId: string;
  readonly storeId: string;
  readonly name: string;
  readonly sourceFilename: string | null;
  readonly sourceFile: Uint8Array<ArrayBuffer>;
  readonly sourceFormatId: WorkbookFormatId;
  readonly createdBy: string | null;
}

export interface InspectContext<S extends LayoutSpec, TRow, TConfig> {
  readonly scope: StoreScope;
  readonly config: TConfig;
  readonly now: Date;
  readonly rows: readonly ImportedRow<TRow>[];
  /** A reader over the first row below the header, kept or not; null when the sheet has none. */
  readonly firstDataRow: RowReader<S> | null;
}

export interface PersistContext<TRow, TConfig, TMeta> {
  readonly parent: ParentFields;
  readonly rows: readonly ImportedRow<TRow>[];
  readonly variantIdByAnchor: ReadonlyMap<string, string>;
  readonly config: TConfig;
  readonly meta: TMeta;
}

export interface ImportOutcome<TMeta> {
  readonly parentId: string;
  readonly name: string;
  readonly itemCount: number;
  readonly rowCount: number;
  readonly distinctCount: number;
  readonly matchedRows: number;
  readonly matchedDistinct: number;
  readonly skippedRows: number;
  readonly prefilledRows: number;
  readonly meta: TMeta;
}

export interface ExportGroup<TItem> {
  readonly tag: number | null;
  readonly items: readonly TItem[];
}

export interface ExportSource<TItem> {
  readonly name: string;
  readonly sourceFile: Uint8Array | null;
  readonly sourceFilename: string | null;
  readonly sourceFormatId: string | null;
  readonly groups: readonly ExportGroup<TItem>[];
}

/** The source file's own value of a write column, on the row being written. */
export interface SourceCells<TWrite extends string> {
  text(key: TWrite): string | null;
  decimal(key: TWrite): string | null;
}

export interface WriteContext<TItem, TWrite extends string> {
  /** Null for a single-file vertical. */
  readonly window: { readonly dayCount: number; readonly label: string } | null;
  /** The planned window value of this anchor; null for a single-file vertical. */
  readonly pick: string | null;
  /** This anchor's item in each group the file covers, in group order (exactly one for a single-file vertical). */
  readonly items: readonly { readonly tag: number | null; readonly item: TItem }[];
  readonly source: SourceCells<TWrite>;
}

export interface CellWrite<TWrite extends string> {
  readonly key: TWrite;
  readonly tag?: number;
  readonly value: string | null;
}

/** The OpenAPI texts and path schemas of a page's two workbook routes. */
export interface WorkbookHttpSpec {
  readonly segment: string;
  readonly idParam: string;
  readonly tag: string;
  // `createRoute`'s `request.params` takes `ZodObject | ZodPipe`; `z.ZodType` does not compile.
  readonly storePathSchema: z.ZodObject;
  readonly itemPathSchema: z.ZodObject;
  readonly importSummary: string;
  readonly importDescription: string;
  readonly importCreated: string;
  readonly import422: string;
  readonly exportSummary: string;
  readonly exportDescription: string;
  readonly exportOk: string;
  readonly export404: string;
  readonly export409: string;
  readonly exportMimes: readonly [string, ...string[]];
}

/** What the generic import needs. */
export interface WorkbookImportAdapter<
  S extends LayoutSpec,
  TRow,
  TConfig,
  TMeta,
  TResponse,
  TWrite extends string,
> {
  readonly page: WorkbookPage;
  /** The @@map name; data for the registry test and logs, NEVER interpolated into SQL. */
  readonly parentTable: WorkbookParentTable;
  /** The lists of this page in this store: a typed Prisma count, `where: { organizationId, storeId }`. */
  countLists(tx: Prisma.TransactionClient, scope: StoreScope): Promise<number>;
  /** Which rows the export may patch, so the rehearsal covers the same set. */
  readonly align: 'anchor-map' | 'cursor-zip';
  readonly http: WorkbookHttpSpec;
  /** The page's import form schema, unchanged. */
  readonly formSchema: z.ZodObject;
  readonly responseSchema: z.ZodType<TResponse>;
  readForm(form: unknown): {
    readonly file: File;
    readonly name: string | undefined;
    readonly config: TConfig;
  };
  readonly formats: readonly WorkbookFormat<S, TRow, TWrite>[];
  inspect(ctx: InspectContext<S, TRow, TConfig>): Promise<TMeta>;
  nameFallback(meta: TMeta): string | null;
  persist(
    tx: Prisma.TransactionClient,
    ctx: PersistContext<TRow, TConfig, TMeta>,
  ): Promise<{ parentId: string; itemCount: number }>;
  /** A unique violation `persist` can raise that is a file rejection (the week index), else null. */
  rejectionForUniqueViolation(err: unknown): WorkbookFileCode | null;
  toResponse(outcome: ImportOutcome<TMeta>): TResponse;
}

/** What the generic export needs. */
export interface WorkbookExportAdapter<S extends LayoutSpec, TRow, TItem, TWrite extends string> {
  readonly page: WorkbookPage;
  readonly http: WorkbookHttpSpec;
  readonly formats: readonly WorkbookFormat<S, TRow, TWrite>[];
  load(scope: StoreScope, id: string): Promise<ExportSource<TItem> | null>;
  /** The resource name `NotFoundError` is thrown with, as today. */
  readonly notFoundResource: string;
  readonly align: 'anchor-map' | 'cursor-zip';
  /** 'period-windows' only with 'anchor-map'. */
  readonly files: 'single' | 'period-windows';
  anchorOf(item: TItem): string;
  /**
   * anchor-map (both file modes): the value this item carries, null when it carries none
   * (not selected, no price). Only items with a non-null pick enter the anchor map, and in
   * period-windows it is also the value compared across periods.
   * cursor-zip: never called; the adapter returns null.
   */
  pick(item: TItem): string | null;
  resolveWriteBack(ctx: WriteContext<TItem, TWrite>): readonly CellWrite<TWrite>[];
  /** The scoped `exportedAt` touch (an updateMany with the full scope). */
  touchExported(scope: StoreScope, id: string): Promise<{ count: number }>;
}

export type WorkbookVerticalAdapter<
  S extends LayoutSpec,
  TRow,
  TConfig,
  TMeta,
  TItem,
  TResponse,
  TWrite extends string,
> = WorkbookImportAdapter<S, TRow, TConfig, TMeta, TResponse, TWrite> &
  WorkbookExportAdapter<S, TRow, TItem, TWrite>;
