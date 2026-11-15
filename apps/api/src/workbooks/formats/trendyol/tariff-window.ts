// The window of a Trendyol tariff export, shared by the commission and Plus commission
// tariff formats: both write `<days> Gunluk Fiyat` into their tariff selection column
// and name each window file with the same day-count suffix.

import { TARIFF_WEEK_DAYS } from '@pazarsync/utils';

import type { WriteValueSpec } from '../../format';
import { TARIFF_SELECTION_PATTERN, tariffSelectionLabel } from './labels';

/** The unit of a window file's name suffix, as in `-3-gunluk`. */
export const TARIFF_WINDOW_FILE_UNIT = 'gunluk';

/**
 * The tariff selection column's write rule: `<days> Gunluk Fiyat`, at most a whole week
 * wide. The adapters read every window label an upload's periods give against it too
 * (`requireWritableWindows`).
 */
export const TARIFF_SELECTION_WRITE: WriteValueSpec = {
  kind: 'text',
  pattern: TARIFF_SELECTION_PATTERN,
  probe: tariffSelectionLabel(TARIFF_WEEK_DAYS),
};
