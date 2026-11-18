import type { Prisma } from '@pazarsync/db';

/**
 * Wraps a transaction client so every model-delegate method call bumps a counter -- the
 * count is the number of DB round-trips, the exact N+1 metric. `new Proxy` preserves
 * the target's type, so the wrapped client is still a `Prisma.TransactionClient`.
 */
export function countingTransactionClient(
  tx: Prisma.TransactionClient,
  bump: () => void,
): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      const isModelDelegate =
        typeof prop === 'string' &&
        !prop.startsWith('$') &&
        !prop.startsWith('_') &&
        typeof value === 'object' &&
        value !== null;
      if (!isModelDelegate) {
        return value;
      }
      return new Proxy(value, {
        get(delegate, methodName, delegateReceiver) {
          const method: unknown = Reflect.get(delegate, methodName, delegateReceiver);
          if (typeof method !== 'function') {
            return method;
          }
          return (...args: unknown[]): unknown => {
            bump();
            return Reflect.apply(method, delegate, args);
          };
        },
      });
    },
  });
}
