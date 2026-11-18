import { OpenAPIHono, type OpenAPIHonoOptions } from '@hono/zod-openapi';
import type { Env } from 'hono';

import { ValidationError, type ValidationIssue } from './errors';

/**
 * Field issue code of a Zod rule that sets no code of its own: Zod's default message is an
 * English sentence, never a machine code, so the hook puts this code on the wire instead.
 */
export const INVALID_FIELD = 'INVALID_FIELD';

// A SCREAMING_SNAKE_CASE issue message, the only kind the hook passes through unchanged.
const FIELD_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Shared validation hook wired on every OpenAPIHono instance in this codebase.
 *
 * When `@hono/zod-openapi` runs its `zValidator` middleware and Zod reports
 * failure, this hook fires. It maps each ZodIssue to our `ValidationIssue`
 * shape and throws a `ValidationError`, which propagates to `app.onError` →
 * `problemDetailsForError` → RFC 7807 422 response.
 *
 * Contract for validator files: set `issue.message` to the SCREAMING_SNAKE_CASE
 * error code (e.g. `"INVALID_NAME_TOO_SHORT"`) — the hook surfaces that as the
 * `code` field in `errors[]`. A rule without a code (a message that is not
 * SCREAMING_SNAKE_CASE, for example Zod's own sentence for a bare `.uuid()` or
 * `z.enum([...])`) answers `INVALID_FIELD`, so a library sentence never reaches
 * `errors[].code`; `meta.zodCode` still tells such rules apart.
 *
 * A cross-field refinement that needs to name WHICH element of an array failed
 * (so the frontend can highlight that row) passes `params` on the issue:
 * `ctx.addIssue({ code: 'custom', message: 'CUSTOM_PRICE_REQUIRED', path: ['selections'],
 * params: { itemId } })`. Those keys are merged into `errors[].meta` alongside
 * `zodCode`, which is the same shape a hand-thrown `ValidationError` produces —
 * so a Zod-side and a service-side guard on the same field look identical on the wire.
 */
function validationDefaultHook(result: { success: boolean; error?: { issues: unknown[] } }): void {
  if (!result.success && result.error !== undefined) {
    const issues: ValidationIssue[] = (result.error.issues as unknown[]).map((raw) => {
      const issue = raw as {
        code: string;
        message: string;
        path: Array<string | number>;
        params?: Record<string, unknown>;
      };
      return {
        field: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
        code: FIELD_CODE_PATTERN.test(issue.message) ? issue.message : INVALID_FIELD,
        meta: { zodCode: issue.code, ...(issue.params ?? {}) },
      };
    });
    throw new ValidationError(issues);
  }
}

/**
 * Factory for OpenAPIHono instances used throughout this codebase.
 *
 * Always use this instead of `new OpenAPIHono()` in route files so the shared
 * `validationDefaultHook` is applied. Without it, Zod failures return the
 * library's default 400 body instead of our RFC 7807 422 `VALIDATION_ERROR`.
 *
 * Pass `options.defaultHook` to override the validation hook for a sub-app that
 * must handle Zod failures differently (e.g. the Trendyol webhook receiver,
 * which turns a validation failure into a logged 200 so Trendyol stops its
 * infinite retry loop). Omit it to keep the standard `VALIDATION_ERROR` mapping.
 */
export function createSubApp<E extends Env = Env>(
  options: { defaultHook?: OpenAPIHonoOptions<E>['defaultHook'] } = {},
): OpenAPIHono<E> {
  return new OpenAPIHono<E>({ defaultHook: options.defaultHook ?? validationDefaultHook });
}
