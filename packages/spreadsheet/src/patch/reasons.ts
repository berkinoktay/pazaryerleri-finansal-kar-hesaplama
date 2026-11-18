// `meta.reason` vocabularies of the errors the export patch path and the upload gate
// throw. A reason names the rule that refused the file; the meta never carries cell
// text.

/** Reasons of MALFORMED_SHEET. */
export const MALFORMED_SHEET_REASONS = {
  MARKUP: 'markup',
  STRUCTURE: 'structure',
  NAMESPACE: 'namespace',
  ROW_REF: 'row-ref',
  CELL_REF: 'cell-ref',
  READER_MISMATCH: 'reader-mismatch',
  TARGET_PART: 'target-part',
  FORMULA_TARGET: 'formula-target',
  SHARED_FORMULA: 'shared-formula',
  MERGED_TARGET: 'merged-target',
  // A malformed range ref: of a merged range, or of an array or data table formula.
  MERGE_REF: 'merge-ref',
} as const;

/** Reasons of UNSUPPORTED_ENCODING. */
export const UNSUPPORTED_ENCODING_REASONS = {
  DECLARATION: 'declaration',
  BYTES: 'bytes',
} as const;

/** Reasons of PAYLOAD_TOO_LARGE raised by the patch path. */
export const PATCH_LIMIT_REASONS = {
  GROWTH: 'patch-growth',
  OUTPUT: 'patch-output',
} as const;

/**
 * Reasons of PAYLOAD_TOO_LARGE raised by the upload gate. Its byte and entry caps carry
 * none; a reason names a cap a caller may want to tell apart from them (the formula scan
 * budget, the DOM weight).
 */
export const UPLOAD_LIMIT_REASONS = {
  // The formula fields of all parts together, raw and in NFKC form, exceed what the gate
  // reads of one upload (MAX_FORMULA_SCAN_UNITS).
  FORMULA_SCAN_BUDGET: 'formula-scan-budget',
  // The reader parts together exceed MAX_XML_DOM_WEIGHT.
  DOM_WEIGHT: 'dom-weight',
} as const;

/** Reasons of CORRUPT_FILE raised by the zip and package checks of the gate and the patch path. */
export const ZIP_REJECT_REASONS = {
  LAYOUT: 'zip-layout',
  ZIP64: 'zip64',
  ENCRYPTED: 'zip-encrypted',
  METHOD: 'zip-method',
  VIEW_MISMATCH: 'zip-view-mismatch',
  PACKAGE_PART: 'package-part',
  ROOT_RELS: 'root-rels',
  // A kept XML part that is not UTF-8 text, or whose declaration names another encoding.
  PART_ENCODING: 'part-encoding',
  // An entry name that is not a canonical part name (see the entry name rule in guards.ts).
  ENTRY_NAME: 'entry-name',
} as const;

/** Reasons of UNSAFE_CONTENT raised by the package and content checks of the gate. */
export const UNSAFE_CONTENT_REASONS = {
  // A macro, an embedded object, an ActiveX or form control, an add-in, a web publishing
  // item, an external link, or a relationship to content outside the package.
  UNSAFE_PART: 'unsafe-part',
  // A formula field that calls a function outside the safe list, holds a DDE or external
  // workbook reference, an escape or a format character, or content the scan cannot
  // read; or a macro assignment.
  UNSAFE_FORMULA: 'unsafe-formula',
} as const;

/** One of UNSAFE_CONTENT_REASONS. */
export type UnsafeContentReason =
  (typeof UNSAFE_CONTENT_REASONS)[keyof typeof UNSAFE_CONTENT_REASONS];
