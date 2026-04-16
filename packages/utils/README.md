# @pazarsync/utils

Pure utility functions shared between the frontend and the backend. No framework dependencies, no I/O — testable in isolation, TDD discipline.

## What's here

| Module          | Purpose                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `currency.ts`   | TRY formatting and `decimal.js` helpers. Money is never a `number` — always `Decimal`.   |
| `date.ts`       | ISO 8601 parsing, formatting, and timezone-safe helpers. The wire format is always UTC. |
| `cursor.ts`     | `encodeCursor` / `decodeCursor` for paginated APIs. Cursors carry sort + version locks.  |
| `validation.ts` | Zod schemas reused on both sides (e.g. `cursorPaginationSchema`).                        |

## Decision rules

- If both frontend and backend need a function → it lives **here**
- If only the frontend needs it → `apps/web/src/lib/`
- If only the backend needs it → `apps/api/src/lib/`

Same function defined in two places is a bug — see the "No Utility Duplication" section in the root [`CLAUDE.md`](../../CLAUDE.md).

## Cursor pagination

Cursors are opaque base64 strings that encode `{ v, sort, values: { …, id } }`. The server validates that the request's `sort` parameter matches the cursor's locked sort; mismatch returns `400 CURSOR_SORT_MISMATCH`. This prevents pagination from silently breaking when a client changes sort mid-iteration.

## Money

Use `decimal.js` end-to-end:

```typescript
import { formatCurrency } from '@pazarsync/utils';
import Decimal from 'decimal.js';

const profit = new Decimal('100.10').sub('23.64').sub('29.99'); // 46.47
formatCurrency(profit); // "₺46,47"
```

Never use floating-point arithmetic for money. `100.10 - 23.64 - 29.99` in JS gives `46.46999999999999` — quietly wrong, hard to catch in code review.

## Testing

```bash
pnpm --filter @pazarsync/utils test
```

Every public function in this package MUST have unit tests with TDD discipline (write the test → see it fail → implement → see it pass).
