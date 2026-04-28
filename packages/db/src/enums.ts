// Server-safe enum re-exports. This entry point intentionally does NOT
// import or initialize the Prisma client — `@pazarsync/db` (root entry)
// constructs a PrismaClient at module load and reads DATABASE_URL,
// which would crash a browser bundle. Apps that only need enum values
// or types (e.g. apps/web for Zod schema parity) import from
// `@pazarsync/db/enums` to stay free of that side effect.

export * from '../generated/prisma/enums';
