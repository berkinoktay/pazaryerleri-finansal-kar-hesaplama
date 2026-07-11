// Unit coverage for findMissingPublicationFlags' two negative branches, driven by
// a hand-built fake client (no DB): (1) the pg_publication row is absent -> every
// required flag counts as missing; (2) a flag is published false -> it is
// reported while a published-true flag is not. We never touch the real
// publication -- the fake $queryRaw returns the stubbed rows directly.
//
// The positive path (all flags present) and the aggregate assertCriticalDdl throw
// are covered by the integration suite (tests/integration/ddl-assertions.test.ts)
// against a bootstrapped database.

import { describe, expect, it } from 'vitest';

import {
  findMissingPublicationFlags,
  REQUIRED_PUBLICATION_FLAGS,
} from '../../../src/lib/ddl-assertions';

interface PublicationFlagRow {
  pubinsert: boolean;
  pubupdate: boolean;
  pubdelete: boolean;
  pubtruncate: boolean;
}

// Minimal client whose $queryRaw resolves to a fixed row set -- structurally the
// surface findMissingPublicationFlags reads, so no PrismaClient or DB is needed.
function fakeClient(rows: PublicationFlagRow[]): {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<PublicationFlagRow[]>;
} {
  return {
    $queryRaw: () => Promise.resolve(rows),
  };
}

describe('findMissingPublicationFlags', () => {
  it('reports every required flag missing when the publication row is absent', async () => {
    const missing = await findMissingPublicationFlags(fakeClient([]), REQUIRED_PUBLICATION_FLAGS);
    expect(missing).toEqual(['pubinsert', 'pubupdate']);
  });

  it('reports only the flags published false, not the ones published true', async () => {
    const client = fakeClient([
      { pubinsert: false, pubupdate: true, pubdelete: true, pubtruncate: true },
    ]);
    const missing = await findMissingPublicationFlags(client, REQUIRED_PUBLICATION_FLAGS);
    expect(missing).toEqual(['pubinsert']);
  });
});
