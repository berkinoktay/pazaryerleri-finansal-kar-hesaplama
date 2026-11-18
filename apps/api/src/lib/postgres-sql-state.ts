// The SQLSTATE of a Postgres error as Prisma 7 and @prisma/adapter-pg raise it. Shared by
// the import's error mapping and the store quota lock.

/** The `cause` of a driver adapter error: Postgres' SQLSTATE in `originalCode`. */
interface DriverAdapterCause {
  readonly originalCode: string;
}

/** True when `value` carries a driver adapter `cause` whose `originalCode` is a string. */
function isDriverAdapterFailure(value: unknown): value is { readonly cause: DriverAdapterCause } {
  if (typeof value !== 'object' || value === null || !('cause' in value)) return false;
  const { cause } = value;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'originalCode' in cause &&
    typeof cause.originalCode === 'string'
  );
}

/**
 * The SQLSTATE of a database error raised through Prisma 7 and @prisma/adapter-pg, or
 * null. Measured against Postgres: a typed write whose failure Prisma maps to no code of
 * its own (22021, 22007, 22009) rejects with the adapter's DriverAdapterError itself,
 * which has no `code` and carries `cause: { originalCode, code, kind: 'postgres', ... }`;
 * a failure Prisma maps to a P code (22001 as P2000, 23505 as P2002) rejects with a
 * PrismaClientKnownRequestError holding that same DriverAdapterError under
 * `meta.driverAdapterError`. Both carry the SQLSTATE in `cause.originalCode`.
 */
export function postgresSqlState(err: unknown): string | null {
  if (isDriverAdapterFailure(err)) return err.cause.originalCode;
  if (typeof err !== 'object' || err === null || !('meta' in err)) return null;
  const { meta } = err;
  if (typeof meta !== 'object' || meta === null || !('driverAdapterError' in meta)) return null;
  const { driverAdapterError } = meta;
  return isDriverAdapterFailure(driverAdapterError) ? driverAdapterError.cause.originalCode : null;
}
