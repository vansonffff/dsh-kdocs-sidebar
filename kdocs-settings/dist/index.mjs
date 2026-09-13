/**
 * `kdocs-settings` Host face — deliberately empty.
 *
 * Since 0.2.0 this package is a **status-only panel**: the section reads
 * `remote.kdocs.status()` and renders whatever the core plugin's Provider
 * reports. There is nothing left for a Host half to do, and that is the point:
 *
 * - no `credentials` refs, so nothing here can read or write a token;
 * - no `node:child_process`, so there is no second `kdocs-cli` runner to drift
 *   from the one in `dsh-kdocs-inside`;
 * - no timers or subscriptions, so mounting and unmounting it is a no-op.
 *
 * The export is kept because the composition mounts this package as one loader
 * row and Cordis expects a plugin shape from it — a function is the smallest
 * honest one. Omitting it would also load (Cordis skips a module with no
 * `apply`), but an explicit no-op states the intent instead of leaving it to be
 * inferred from an empty module.
 *
 * @module kdocs-settings
 */

/**
 * Mount the (empty) Host half.
 *
 * @returns {void}
 */
export function apply() {
  // Intentionally empty: see the module note. Every status the panel shows comes
  // from `remote.kdocs.status()`, which the core plugin owns.
}
