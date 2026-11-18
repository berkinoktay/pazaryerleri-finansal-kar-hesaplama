// `meta.reason` vocabularies of the errors the export patch path and the upload gate
// throw, and the `meta.detail` vocabulary of UNSAFE_CONTENT. A reason names the rule
// that refused the file, a detail the one check of that rule that fired; the meta never
// carries cell text.

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
  // The formula fields of all parts together, raw plus the NFKC form of each field NFKC
  // changes, exceed what the gate reads of one upload (MAX_FORMULA_SCAN_UNITS).
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

/**
 * Details (`meta.detail`) of UNSAFE_CONTENT: the one check that refused the file. Every
 * UNSAFE_CONTENT the gate raises carries one, beside its `reason` when it has one, so a
 * log can tell a real macro from a false positive of a broad rule. A detail is a fixed
 * rule name: it never holds file text, a part name or a URL.
 */
export const UNSAFE_CONTENT_DETAILS = {
  // Package checks (unsafe-parts.ts).
  // A relationship type of a digital signature (origin, signature or certificate).
  DIGITAL_SIGNATURE: 'digital-signature',
  // A relationship type that names an active part (a macro project, an embedded object...).
  ACTIVE_RELATIONSHIP: 'active-relationship',
  // An external relationship other than a worksheet web hyperlink.
  EXTERNAL_TARGET: 'external-target',
  // An internal relationship whose target is an absolute URL.
  ABSOLUTE_TARGET: 'absolute-target',
  // An entry named like a macro, embedded or external link part.
  ACTIVE_PART_NAME: 'active-part-name',
  // A content type of an active part in the content types part.
  ACTIVE_CONTENT_TYPE: 'active-content-type',
  // Content scan (content-scan.ts).
  // A formula field the formula scan refuses, or one with something other than text.
  FORMULA: 'formula',
  // A script element with content.
  SCRIPT: 'script',
  // A macro assignment: a macro attribute, or a macro element with content.
  MACRO: 'macro',
  // A URL attribute that leaves the package.
  EXTERNAL_URL: 'external-url',
  // A style attribute or a style element whose CSS loads a resource.
  CSS_LOAD: 'css-load',
  // Any other attribute value holding a CSS load call: the broad rule, false positives
  // included (a word ending in url, src or image glued to '(').
  CSS_LOAD_ATTRIBUTE: 'css-load-attribute',
  // Style element text the scan cannot decode.
  CSS_UNDECODABLE: 'css-undecodable',
  // A processing instruction that loads a stylesheet.
  STYLESHEET_INSTRUCTION: 'stylesheet-instruction',
  // An element other than a hyperlink naming an external hyperlink relationship.
  HYPERLINK_REUSE: 'hyperlink-reuse',
  // An SVG animation element in web content.
  SVG_ANIMATION: 'svg-animation',
  // An event handler attribute in web content.
  EVENT_HANDLER: 'event-handler',
  // An attribute of web content that names a web resource.
  WEB_RESOURCE: 'web-resource',
  // An embedded object, a control, a frame, a script or a web publishing item.
  ACTIVE_ELEMENT: 'active-element',
  // Past markup the strict lexer refuses: an active element.
  LOOSE_ACTIVE_ELEMENT: 'loose-active-element',
  // Past markup the strict lexer refuses: a field, macro or script element, or a
  // formula or macro attribute name.
  LOOSE_FORMULA: 'loose-formula',
  // Past markup the strict lexer refuses: a character reference.
  LOOSE_REFERENCE: 'loose-reference',
  // Past markup the strict lexer refuses: a CSS load call.
  LOOSE_CSS: 'loose-css',
  // Past markup the strict lexer refuses: a name that could be a link, a style, an
  // event handler or a relationship id.
  LOOSE_LINK: 'loose-link',
  // Inside a style element: markup the strict lexer refuses.
  LOOSE_STYLE: 'loose-style',
  // A DOCTYPE or ENTITY declaration.
  DOCTYPE: 'doctype',
  // A reference to an entity other than the predefined ones.
  UNKNOWN_ENTITY: 'unknown-entity',
  // More than MAX_XMLNS_DECLARATIONS_PER_PART namespace declarations in scope.
  NAMESPACE_DECLARATIONS: 'namespace-declarations',
  // Reader parts (guards.ts, part-checks.ts).
  // An element name longer than MAX_XML_NAME_LENGTH.
  ELEMENT_NAME_LENGTH: 'element-name-length',
  // A number format longer than MAX_FORMAT_CODE_LENGTH.
  NUMBER_FORMAT_LENGTH: 'number-format-length',
} as const;

/** One of UNSAFE_CONTENT_DETAILS. */
export type UnsafeContentDetail =
  (typeof UNSAFE_CONTENT_DETAILS)[keyof typeof UNSAFE_CONTENT_DETAILS];

const UNSAFE_CONTENT_DETAIL_SET: ReadonlySet<string> = new Set(
  Object.values(UNSAFE_CONTENT_DETAILS),
);

/** Whether `value` is one of UNSAFE_CONTENT_DETAILS: a reader of `meta.detail` trusts nothing else. */
export function isUnsafeContentDetail(value: unknown): value is UnsafeContentDetail {
  return typeof value === 'string' && UNSAFE_CONTENT_DETAIL_SET.has(value);
}
