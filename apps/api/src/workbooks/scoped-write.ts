// A follow-up write of the workbook pipeline is an updateMany (or deleteMany) whose
// `where` carries the record id, the organization and the store, so it can never touch
// another tenant's row. Its count is checked: anything but exactly one row means the
// record is not in this store (or is gone), which is a 404, as a read would answer.

import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError } from '../lib/errors';

/** Awaits a scoped write; a count other than 1 is `NotFoundError(resource, id)`. */
export async function assertScopedWrite(
  write: Promise<{ count: number }>,
  resource: string,
  id: string,
): Promise<void> {
  let count: number;
  try {
    ({ count } = await write);
  } catch (err) {
    mapPrismaError(err);
  }
  if (count !== 1) throw new NotFoundError(resource, id);
}
