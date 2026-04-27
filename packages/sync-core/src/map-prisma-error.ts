import { ConflictError, InvalidReferenceError, NotFoundError } from './errors';

/**
 * Translate a Prisma error into one of our domain errors so `app.onError`
 * can return a proper RFC 7807 ProblemDetails — instead of collapsing
 * every DB-level failure to 500 INTERNAL_ERROR.
 *
 * Services wrap Prisma calls with:
 *
 *   try { await prisma.x.update(...) } catch (err) { mapPrismaError(err); }
 *
 * (Or, at the top of a service file, a small local `run<T>()` wrapper.)
 *
 * Uses structural checks (not `instanceof Prisma.PrismaClientKnownRequestError`)
 * to stay resilient to Prisma 7's driver-adapter wrapping and to avoid a
 * runtime import cycle through `@pazarsync/db`.
 */
interface PrismaKnownRequestErrorShape {
  code: string;
  meta?: Record<string, unknown>;
}

function isPrismaKnownRequestError(err: unknown): err is PrismaKnownRequestErrorShape {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('P')
  );
}

export function mapPrismaError(err: unknown): never {
  if (!isPrismaKnownRequestError(err)) {
    throw err;
  }
  switch (err.code) {
    case 'P2002': {
      const target = extractTarget(err.meta);
      throw new ConflictError(
        target.length > 0
          ? `Unique constraint violated on ${target.join(', ')}`
          : 'Unique constraint violated',
      );
    }
    case 'P2025': {
      const cause =
        typeof err.meta?.['cause'] === 'string' ? (err.meta['cause'] as string) : 'record';
      throw new NotFoundError(cause);
    }
    case 'P2003': {
      const field =
        typeof err.meta?.['field_name'] === 'string'
          ? (err.meta['field_name'] as string)
          : 'unknown-field';
      throw new InvalidReferenceError(field, 'unknown');
    }
    default:
      throw err;
  }
}

function extractTarget(meta: Record<string, unknown> | undefined): string[] {
  if (meta === undefined) return [];
  const target = meta['target'];
  if (Array.isArray(target)) return target.filter((t): t is string => typeof t === 'string');
  if (typeof target === 'string') return [target];
  return [];
}
