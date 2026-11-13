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

/** Reasons of CORRUPT_FILE raised by the zip and package checks of the gate and the patch path. */
export const ZIP_REJECT_REASONS = {
  LAYOUT: 'zip-layout',
  ZIP64: 'zip64',
  ENCRYPTED: 'zip-encrypted',
  METHOD: 'zip-method',
  VIEW_MISMATCH: 'zip-view-mismatch',
  PACKAGE_PART: 'package-part',
  ROOT_RELS: 'root-rels',
} as const;

/** Reasons of UNSAFE_CONTENT raised by the package checks of the gate. */
export const UNSAFE_CONTENT_REASONS = {
  // A macro, an embedded object, an ActiveX control or an external link.
  UNSAFE_PART: 'unsafe-part',
} as const;
