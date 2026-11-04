/**
 * Profit engine version. Stamped onto every profit statement so a stored result
 * can be told apart from one produced by a later engine. Bump when a change to the
 * engine would alter the computed numbers for the same inputs.
 *
 * 3: statements of excluded orders no longer carry a net profit or margins.
 * 4: every statement records a reconciliation status derived from its selected lines.
 */
export const PROFIT_ENGINE_VERSION = 4;
