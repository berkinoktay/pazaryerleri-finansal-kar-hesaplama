// Fingerprint of everything that shapes the isolated test DB template
// (`pnpm db:test-setup`): schema, governance SQL and the reference/fixture
// seeders. setup-test-db.ts stamps it on the template with COMMENT ON
// DATABASE; the per-worker clone setup compares it before cloning, so a stale
// template fails fast with "run pnpm db:test-setup" instead of as missing
// columns deep inside a test.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PACKAGE_DIR, '../..');
const SQL_DIR = path.join(REPO_ROOT, 'supabase/sql');
// The reference-seed SQL the seeders replay into the template.
const REFERENCE_SEED_DIR = path.join(PACKAGE_DIR, 'prisma/reference-seed');
const HASH_LENGTH = 16;

export const TEMPLATE_COMMENT_PREFIX = 'pazarsync-test-template:';

/** Every `.sql` file directly inside `dir`, sorted by name, as absolute paths. */
function sortedSqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => path.join(dir, file));
}

function templateInputFiles(): string[] {
  return [
    path.join(PACKAGE_DIR, 'prisma/schema.prisma'),
    path.join(PACKAGE_DIR, 'src/test-support.ts'),
    path.join(PACKAGE_DIR, 'scripts/seed-reference.ts'),
    path.join(PACKAGE_DIR, 'scripts/seed-test-fixtures.ts'),
    ...sortedSqlFiles(REFERENCE_SEED_DIR),
    ...sortedSqlFiles(SQL_DIR),
  ];
}

export function templateInputsHash(): string {
  const hash = createHash('sha256');
  for (const file of templateInputFiles()) {
    hash.update(path.relative(REPO_ROOT, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, HASH_LENGTH);
}

export function templateComment(): string {
  return `${TEMPLATE_COMMENT_PREFIX}${templateInputsHash()}`;
}
