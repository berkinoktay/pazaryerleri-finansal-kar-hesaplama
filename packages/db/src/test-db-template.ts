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
const HASH_LENGTH = 16;

export const TEMPLATE_COMMENT_PREFIX = 'pazarsync-test-template:';

function templateInputFiles(): string[] {
  const sqlFiles = readdirSync(SQL_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => path.join(SQL_DIR, file));
  return [
    path.join(PACKAGE_DIR, 'prisma/schema.prisma'),
    path.join(PACKAGE_DIR, 'src/test-support.ts'),
    path.join(PACKAGE_DIR, 'scripts/seed-reference.ts'),
    ...sqlFiles,
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
