// Export service for the saved Commission Tariffs feature.
//
// The seller re-uploads the result to Trendyol VERBATIM, so we patch the seller's
// chosen price + tariff selection into Trendyol's EXACT original file (kept at
// import as `sourceFile`) rather than regenerating. Only two cells per selected
// product change: "YENİ TSF (FİYAT GÜNCELLE)" ← the chosen band price, and
// "Tarife Seçimi" ← "{N} Günlük Fiyat" (matching Trendyol's own filled exports,
// e.g. the melontik sample). Everything else — every other column, the styles,
// even Trendyol's bogus <dimension> — is left byte-for-byte intact.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';

import { ConflictError, NotFoundError } from '../lib/errors';
import { resolveTariffLayout, type TariffLayout } from './commission-tariff-layout';
import { parseStoredBands } from './commission-tariff.types';

const SHEET_NAME = 'KomisyonTarifeleriÜrünleri';
const WORKSHEET_PREFIX = 'xl/worksheets/';

// ─── Column-letter helpers ──────────────────────────────────────────────────

function columnLetter(index: number): string {
  let letters = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellText(row: readonly unknown[], idx: number): string | null {
  const value = row[idx];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

// ─── Per-product patch (the two cells the seller's selection writes) ─────────

interface RowPatch {
  newPrice: string;
  selection: string;
}

// ─── XML row patching ────────────────────────────────────────────────────────

const CELL_RE = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;
const CELL_REF_RE = /\br="([A-Z]+)\d+"/;
const ROW_OPEN_RE = /<row\b[^>]*>/;
const ROW_RE = /<row\b[^>]*>[\s\S]*?<\/row>/g;
const ROW_NUM_RE = /\br="(\d+)"/;

/** Rewrites one row, replacing the two patched cells and keeping the rest verbatim. */
function patchRow(rowXml: string, rowNum: number, patch: RowPatch, layout: TariffLayout): string {
  const cells = new Map<number, string>();
  let match: RegExpExecArray | null;
  CELL_RE.lastIndex = 0;
  while ((match = CELL_RE.exec(rowXml)) !== null) {
    const cellXml = match[0];
    const ref = CELL_REF_RE.exec(cellXml);
    if (ref?.[1] === undefined) continue;
    cells.set(columnIndex(ref[1]), cellXml);
  }

  const priceLetter = columnLetter(layout.newTsf);
  cells.set(layout.newTsf, `<c r="${priceLetter}${rowNum}"><v>${patch.newPrice}</v></c>`);
  const selLetter = columnLetter(layout.tariffSelection);
  cells.set(
    layout.tariffSelection,
    `<c r="${selLetter}${rowNum}" t="inlineStr"><is><t>${xmlEscape(patch.selection)}</t></is></c>`,
  );

  const openTag = ROW_OPEN_RE.exec(rowXml)?.[0] ?? `<row r="${rowNum}">`;
  const body = [...cells.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, xml]) => xml)
    .join('');
  return `${openTag}${body}</row>`;
}

/** Patches every selected row's two cells across all worksheets, leaving the rest intact. */
function patchWorkbook(
  source: Buffer,
  layout: TariffLayout,
  rowPatches: Map<number, RowPatch>,
): Buffer {
  if (rowPatches.size === 0) return source;

  const entries = unzipSync(new Uint8Array(source));
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith(WORKSHEET_PREFIX) || !name.endsWith('.xml')) continue;
    const xml = strFromU8(bytes).replace(ROW_RE, (rowXml: string) => {
      const rowNum = ROW_NUM_RE.exec(rowXml);
      if (rowNum?.[1] === undefined) return rowXml;
      const patch = rowPatches.get(Number(rowNum[1]));
      return patch === undefined ? rowXml : patchRow(rowXml, Number(rowNum[1]), patch, layout);
    });
    entries[name] = strToU8(xml);
  }
  return Buffer.from(zipSync(entries));
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface ExportTariffResult {
  filename: string;
  file: Buffer;
}

/**
 * Produces the seller's re-uploadable Trendyol file: the original upload with the
 * chosen price written into "YENİ TSF" and "{N} Günlük Fiyat" into "Tarife
 * Seçimi" for every product that has a selection. Marks the tariff exported.
 * Throws `NotFoundError` if the tariff is not in this store, `ConflictError` if
 * no source file was kept (older tariff) or the stored file is unreadable.
 */
export async function exportTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<ExportTariffResult> {
  let tariff;
  try {
    tariff = await prisma.commissionTariff.findFirst({
      where: { id: tariffId, organizationId: orgId, storeId },
      select: {
        name: true,
        sourceFile: true,
        sourceFilename: true,
        periods: {
          select: {
            dayCount: true,
            items: {
              select: {
                barcode: true,
                selectedBand: true,
                customPrice: true,
                currentPrice: true,
                bands: true,
              },
            },
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (tariff === null) {
    throw new NotFoundError('CommissionTariff', tariffId);
  }
  if (tariff.sourceFile === null) {
    throw new ConflictError('Tariff has no stored source file to export');
  }

  // Per-barcode patch from the seller's selections. The UI selects one band per
  // product; if multiple periods carry a selection, the last one wins.
  const patchByBarcode = new Map<string, RowPatch>();
  for (const period of tariff.periods) {
    for (const item of period.items) {
      if (item.selectedBand === null) continue;
      const band = parseStoredBands(item.bands).find((b) => b.key === item.selectedBand);
      const bandPrice = band?.upperLimit ?? item.currentPrice.toFixed(2);
      const newPrice = item.customPrice !== null ? item.customPrice.toFixed(2) : bandPrice;
      const selection =
        period.dayCount !== null ? `${period.dayCount} Günlük Fiyat` : 'Günlük Fiyat';
      patchByBarcode.set(item.barcode, { newPrice, selection });
    }
  }

  const source = Buffer.from(tariff.sourceFile);
  const grid = await readWorkbookGrid(source, { sheetName: SHEET_NAME });
  const layout = resolveTariffLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ConflictError('Stored tariff file is not a recognizable Trendyol export');
  }

  // Map each data row's barcode to its patch, keyed by the 1-based Excel row.
  const rowPatches = new Map<number, RowPatch>();
  for (let i = 1; i < grid.length; i += 1) {
    const barcode = cellText(grid[i] ?? [], layout.fixed.barcode);
    if (barcode === null) continue;
    const patch = patchByBarcode.get(barcode);
    if (patch !== undefined) rowPatches.set(i + 1, patch);
  }

  const file = patchWorkbook(source, layout, rowPatches);

  try {
    await prisma.commissionTariff.update({
      where: { id: tariffId },
      data: { exportedAt: new Date() },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return { filename: tariff.sourceFilename ?? `${tariff.name}.xlsx`, file };
}
