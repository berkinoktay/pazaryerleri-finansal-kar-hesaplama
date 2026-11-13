import { CELL_KEY_BASE } from './constants';

const ALPHABET_SIZE = 26;
const CHAR_CODE_A = 65;
// 'A' is column 1, so a letter's column is its code minus the code just before 'A'.
const CHAR_CODE_BEFORE_A = CHAR_CODE_A - 1;

/** Converts an Excel column-letter reference (e.g. "AI") to a 1-based column number. */
export function colRefToNumber(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * ALPHABET_SIZE + (ch.charCodeAt(0) - CHAR_CODE_BEFORE_A);
  return n;
}

/** 1-based column number to Excel column letters (1 -> A, 27 -> AA). */
export function columnLetters(column: number): string {
  let out = '';
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / ALPHABET_SIZE)) {
    out = String.fromCharCode(CHAR_CODE_A + ((rest - 1) % ALPHABET_SIZE)) + out;
  }
  return out;
}

/**
 * One number per cell, for a 1-based `row` and `column`: `row * CELL_KEY_BASE +
 * column`. Distinct for every column below CELL_KEY_BASE, and ordered row-major.
 */
export function cellKey(row: number, column: number): number {
  return row * CELL_KEY_BASE + column;
}
