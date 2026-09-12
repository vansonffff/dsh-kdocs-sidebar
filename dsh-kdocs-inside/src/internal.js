/**
 * Small predicates shared across the package's layers.
 *
 * These live apart from `types.js` and `errors.js` so that neither has to
 * import the other, and so both the CLI runner and the Provider can agree on
 * what an `AbortSignal` is without duplicating a duck-typing check.
 *
 * @module kdocs/internal
 */

/**
 * Whether a value is an `AbortSignal`.
 *
 * Checked structurally rather than with `instanceof`, because a signal may
 * originate from a different realm (a Client bundle, a test harness) where the
 * constructor identity does not match.
 *
 * @param {unknown} value - candidate value.
 * @returns {value is AbortSignal} true when the value behaves like a signal.
 */
export function isAbortSignal(value) {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (/** @type {AbortSignal} */ (value).aborted) === 'boolean'
    && typeof (/** @type {AbortSignal} */ (value).addEventListener) === 'function'
  );
}

/**
 * Coerce a value into a plain record without throwing.
 *
 * Responses from the CLI are `unknown` after JSON parsing; every consumer wants
 * "the fields, or nothing" rather than a validation error for an empty payload.
 *
 * @param {unknown} value - candidate value.
 * @returns {Record<string, unknown>} the value as a record, or an empty record.
 */
export function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}
