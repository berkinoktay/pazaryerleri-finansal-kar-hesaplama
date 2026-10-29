// SyncType i18n coverage guard.
//
// The SyncCenter and the page-sync control build message keys from the
// SyncType value: `syncCenter.triggers.<T>`, `syncCenter.syncTypeLabel.<T>` and
// `syncControl.domain.<T>`. next-intl's typed keys only check tr.json, so a new
// enum member could ship with a missing en.json label and no compile error.
// This test loops every SyncType over the three groups in BOTH locales, and
// flags orphan labels left behind by a renamed or removed value.

import { SyncType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const SYNC_TYPES: readonly string[] = Object.values(SyncType);

type LabelGroup = Readonly<Record<string, unknown>>;

interface LocaleGroups {
  locale: 'tr' | 'en';
  triggers: LabelGroup;
  syncTypeLabel: LabelGroup;
  domain: LabelGroup;
}

const LOCALES: readonly LocaleGroups[] = [
  {
    locale: 'tr',
    triggers: tr.syncCenter.triggers,
    syncTypeLabel: tr.syncCenter.syncTypeLabel,
    domain: tr.syncControl.domain,
  },
  {
    locale: 'en',
    triggers: en.syncCenter.triggers,
    syncTypeLabel: en.syncCenter.syncTypeLabel,
    domain: en.syncControl.domain,
  },
];

const GROUP_PATHS = {
  triggers: 'syncCenter.triggers',
  syncTypeLabel: 'syncCenter.syncTypeLabel',
  domain: 'syncControl.domain',
} as const;

type GroupName = keyof typeof GROUP_PATHS;

const GROUP_NAMES: readonly GroupName[] = ['triggers', 'syncTypeLabel', 'domain'];

// `syncCenter.triggers` also holds `cooldownRemaining`, so only the two groups
// keyed purely by SyncType get the orphan check.
const SYNC_TYPE_ONLY_GROUPS: readonly GroupName[] = ['syncTypeLabel', 'domain'];

describe('SyncType i18n coverage', () => {
  it('enumerates at least one SyncType at runtime', () => {
    expect(SYNC_TYPES.length).toBeGreaterThan(0);
  });

  it.each(LOCALES)('$locale has a non-empty label for every SyncType in each group', (groups) => {
    for (const groupName of GROUP_NAMES) {
      const group = groups[groupName];
      for (const syncType of SYNC_TYPES) {
        const label = group[syncType];
        const path = `${GROUP_PATHS[groupName]}.${syncType}`;
        expect(label, `${groups.locale}: missing ${path}`).toBeTypeOf('string');
        expect(label, `${groups.locale}: empty ${path}`).not.toBe('');
      }
    }
  });

  it.each(LOCALES)('$locale carries no orphan SyncType labels', (groups) => {
    for (const groupName of SYNC_TYPE_ONLY_GROUPS) {
      for (const key of Object.keys(groups[groupName])) {
        expect(
          SYNC_TYPES,
          `${groups.locale}: ${GROUP_PATHS[groupName]}.${key} has no matching SyncType`,
        ).toContain(key);
      }
    }
  });
});
