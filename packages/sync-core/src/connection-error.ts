// Detects "database unreachable" failures so callers can render a single,
// calm, actionable log instead of repeating Prisma's multi-line invocation
// dump on every poll/tick while Postgres is down (e.g. `supabase start`
// forgotten in local dev). Pure structural checks — no Prisma import — to
// stay resilient to Prisma 7's driver-adapter error wrapping and to avoid a
// runtime cycle through `@pazarsync/db`. Sibling of `map-prisma-error.ts`.

export interface DbUnreachable {
  /** Parsed from the error when available, else null. */
  host: string | null;
  port: string | null;
}

function readField(err: object, key: string): unknown {
  return (err as Record<string, unknown>)[key];
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Returns `{ host, port }` if `err` is a "can't reach database server"
 * failure, else `null`. Matches three independent signals:
 *   - Prisma `P1001` error code ("Can't reach database server at host:port"),
 *   - the `@prisma/adapter-pg` `{ kind: 'DatabaseNotReachable', host, port }`
 *     shape, and
 *   - the message text as a last-resort fallback.
 * Host/port are taken from structured fields first, then parsed from the
 * message; either may be `null` if neither source yields them.
 */
export function parseDbUnreachableError(err: unknown): DbUnreachable | null {
  if (typeof err !== 'object' || err === null) return null;

  const code = asString(readField(err, 'code'));
  const kind = asString(readField(err, 'kind'));
  const message = err instanceof Error ? err.message : (asString(readField(err, 'message')) ?? '');

  const isUnreachable =
    code === 'P1001' || kind === 'DatabaseNotReachable' || /reach database server/i.test(message);
  if (!isUnreachable) return null;

  let host = asString(readField(err, 'host'));
  let port = asString(readField(err, 'port'));

  if (host === null || port === null) {
    const match = /reach database server at\s+`?([^`:]+?)`?:`?(\d+)`?/i.exec(message);
    if (match !== null) {
      host = host ?? match[1] ?? null;
      port = port ?? match[2] ?? null;
    }
  }

  return { host, port };
}
