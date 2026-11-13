import { PATCH_ERROR_ROW_SAMPLE } from './limits';
import { valueAt } from './xml-lexer';

// The `{ count, rows }` meta of the export patch path's rejections (anchors, merged
// targets, missing rows, formula targets): one shape, built the same way everywhere.

/**
 * Rejected cells of one error: how many, and the PATCH_ERROR_ROW_SAMPLE smallest
 * distinct rows among them, ascending, whatever order the rows arrive in. Each add
 * costs at most PATCH_ERROR_ROW_SAMPLE steps, and nothing grows with the count.
 */
export class RejectedRows {
  count = 0;
  readonly rows: number[] = [];

  add(row: number): void {
    this.count += 1;
    const rows = this.rows;
    let at = rows.length;
    while (at > 0 && valueAt(rows, at - 1) > row) at -= 1;
    if (at >= PATCH_ERROR_ROW_SAMPLE || rows[at - 1] === row) return;
    rows.splice(at, 0, row);
    if (rows.length > PATCH_ERROR_ROW_SAMPLE) rows.pop();
  }
}
