// Limits and constants of the export patch path that only the code under src/patch
// reads. Not exported from the package: the request limits a caller may need stay in
// constants.ts.

// A patched worksheet part may grow to 1.5x its source...
export const PATCH_GROWTH_NUMERATOR = 3;
export const PATCH_GROWTH_DENOMINATOR = 2;
// ...or to its source plus this, whichever is larger (small sheets, inserted cells).
export const PATCH_GROWTH_FLOOR_BYTES = 64 * 1024;
// The largest styles part the export clones date styles into (style-clones.ts). Each
// distinct set of clones parses the rebuilt part once more (at most MAX_PATCH_OUTPUTS
// times a job), so this bounds what the clones add to an export's time; above it the
// date style is dropped as before. Trendyol's own styles parts are a few tens of KB.
export const MAX_CLONED_STYLES_PART_BYTES = 1024 * 1024;
// Row numbers a patch error's meta carries (the first ones, ascending).
export const PATCH_ERROR_ROW_SAMPLE = 10;
// fflate deflate level for a rewritten zip entry.
export const PATCHED_PART_DEFLATE_LEVEL = 6;
// SpreadsheetML main namespaces: transitional and strict.
export const SPREADSHEET_MAIN_NAMESPACES: readonly string[] = [
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
];
