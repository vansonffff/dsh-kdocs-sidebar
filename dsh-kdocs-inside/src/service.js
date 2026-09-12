/**
 * The KDocs capability seam: `ctx.kdocs`.
 *
 * This is a Cordis **Service Definition** in the strict sense — an interface
 * registered under a name, with exactly one implementation mounted behind it.
 * Consumers resolve `ctx.kdocs` and call it without knowing what backs it:
 *
 * ```
 *   ui-sidebar-kdocs   tool-kdocs   (later) Case Workspace
 *            \              |            /
 *             \             |           /
 *              +------ ctx.kdocs ------+
 *                          |
 *                  KDocsCliProvider
 *                          |
 *                    kdocs-cli
 * ```
 *
 * The seam exists so a different Provider (for example a future personal WPS
 * OpenAPI client) can be mounted instead without touching a consumer. Nothing
 * registered here knows that `kdocs-cli` exists.
 *
 * ## Why this class also carries the Remote binding
 *
 * It extends {@link TypertRemoteService}, so the same object that serves
 * `ctx.kdocs` is what the Typert Gateway dispatches `remote.kdocs` calls to.
 * DSH's own `dsh-api-workspace-files` does exactly this, and a *separate* facade
 * service cannot work: the Gateway resolves its receiver by
 * `descriptor.service`, so two services both keyed `kdocs` collide.
 *
 * Two consequences follow, and both are load-bearing:
 *
 * 1. **Plain-identifier signatures.** The Gateway validates a Remote method's
 *    parameters by reading its source text and rejects destructuring, defaults,
 *    and rest parameters. Overload resolution therefore lives in the Provider,
 *    not here.
 * 2. **Aliased remote methods.** The Gateway dispatches `method` to a
 *    *method-named* member, so a remote `status` would have to share a name with
 *    the bare `status` the seam exposes. Instead the remote surface is
 *    implemented as `remoteX`, and {@link module:kdocs/remote-invocations}
 *    declares the alias.
 *
 * **Remote methods return the business value, not an envelope.** An earlier
 * revision wrapped every result in `{ ok, value }`, reasoning that the wire
 * cannot carry a business error code. That was wrong, and the browser proved it:
 * the Client API **already** wraps every call as `{ ok, value }`, so the two
 * layers composed into `{ ok, value: { ok, value } }` and the panel read
 * `value.entries` from an envelope. The framework's own envelope is the only one
 * there should be. A business failure therefore arrives at the Browser as
 * `{ ok: false, error: { code: 'gateway/internal', message } }` — the original
 * message survives, and `{@link KDocsError}` keeps its structured `code` on the
 * Host, where tools and logs read it.
 *
 * @module kdocs/service
 */

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

import { KDocsError } from './errors.js';
import { KDocsCliProvider } from './client/provider.js';

/**
 * The service name this Definition registers under, i.e. `ctx.kdocs`, which is
 * also the wire namespace it is exposed as, i.e. `ctx.remote.kdocs`.
 */
export const KDOCS_SERVICE_NAME = 'kdocs';

/**
 * The registered KDocs capability, and the Host side of `remote.kdocs`.
 *
 * @extends TypertRemoteService
 */
export class KDocsService extends TypertRemoteService {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - the context to register in.
   * @param {ConstructorParameters<typeof KDocsCliProvider>[1]} [options] - Provider configuration.
   */
  constructor(ctx, options = {}) {
    super(ctx, KDOCS_SERVICE_NAME);
    // Cordis's `Service` constructor takes only (ctx, name) — options are ours,
    // so they go to the Provider rather than to the base class.
    /**
     * The mounted Provider.
     *
     * Exposed rather than hidden: a composition wanting Provider-specific
     * behaviour (for example invalidating the status cache after an
     * out-of-band credential change) can reach it explicitly instead of casting
     * `ctx.kdocs`.
     *
     * @type {KDocsCliProvider}
     */
    this.provider = new KDocsCliProvider(ctx, options);
  }

  // ── The seam, as Host consumers call it ──────────────────────────────────

  /**
   * Observe installation and authentication state.
   *
   * @param {AbortSignal} [signal] - cancels the probe.
   * @returns {Promise<import('./types.js').KDocsStatus>} the current status.
   */
  status(signal) {
    return this.provider.status(signal);
  }

  /**
   * Run the browser OAuth login flow.
   *
   * @param {(event: import('./types.js').KDocsLoginEvent) => void} [onEvent] - receives the authorization URL and terminal events.
   * @param {AbortSignal} [signal] - abandons the flow.
   * @returns {Promise<import('./types.js').KDocsStatus>} status after the flow.
   */
  login(onEvent, signal) {
    return this.provider.login(onEvent, signal);
  }

  /**
   * Drop the stored credential.
   *
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('./types.js').KDocsStatus>} status after logout.
   */
  logout(signal) {
    return this.provider.logout(signal);
  }

  /**
   * List a container, or the drive root when `parent` is omitted.
   *
   * @param {import('./types.js').KDocsFileRef} [parent] - folder to list.
   * @param {string} [cursor] - opaque cursor from a previous page.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('./types.js').KDocsPage>} one page of entries.
   */
  list(parent, cursor, signal) {
    return this.provider.list(parent, cursor, signal);
  }

  /**
   * Rename one file or folder.
   *
   * The seam's only write. Everything else it offers reads.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the entry to rename.
   * @param {string} newName - the new name, with or without its extension.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('./types.js').KDocsEntry>} the renamed entry.
   */
  rename(ref, newName, signal) {
    return this.provider.rename(ref, newName, signal);
  }

  /**
   * List one of the drive's curated views (starred, recent, shared, recycle bin).
   *
   * Separate from `list` because it is not the folder tree: these views are the
   * drive's own lists and take no `parent`.
   *
   * @param {import('./types.js').KDocsView} view - which view to list.
   * @param {string} [cursor] - `nextCursor` from a previous page.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('./types.js').KDocsPage>} one page of that view.
   */
  listView(view, cursor, signal) {
    return this.provider.listView(view, cursor, signal);
  }

  /**
   * List one document's saved versions.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the document.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<{ lines: string[] }>} one line per version, newest first.
   */
  listVersions(ref, signal) {
    return this.provider.listVersions(ref, signal);
  }

  /**
   * List the annotations anchored in one document's body.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the document.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<{ lines: string[] }>} one line per annotation.
   */
  listComments(ref, signal) {
    return this.provider.listComments(ref, signal);
  }

  /**
   * Search across drives by keyword.
   *
   * Returns `{ entries, nextCursor }` rather than a bare array: a personal drive
   * routinely matches more than one page, and a bare array would make the first
   * page look like the whole answer.
   *
   * @param {string} query - search keyword.
   * @param {string} [cursor] - `nextCursor` from a previous page.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('./types.js').KDocsSearchResult>} matches and paging state.
   */
  search(query, cursor, options, signal) {
    return this.provider.search(query, cursor, options, signal);
  }

  /**
   * Fetch one entry's metadata.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the entry to stat.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('./types.js').KDocsEntry>} the entry.
   */
  stat(ref, signal) {
    return this.provider.stat(ref, signal);
  }

  /**
   * Extract a document's semantic body.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the document to read.
   * @param {import('./client/provider.js').KDocsReadOptions} [options] - sheet selection and extraction options.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('./types.js').KDocsContent>} the extracted body.
   */
  read(ref, options, signal) {
    return this.provider.read(ref, options, signal);
  }

  /**
   * The document's online WPS URL.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the document.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<string>} the share URL.
   */
  getLink(ref, signal) {
    return this.provider.getLink(ref, signal);
  }

  // ── The Remote face, as `remote.kdocs` reaches it ────────────────────────
  //
  // These return the same business values the seam above does. They are separate
  // methods only because the Gateway matches a descriptor's `method` against a
  // member name, and remote-invocations.js aliases each public wire name onto
  // its `remoteX` implementation.

  /**
   * Remote `status`.
   *
   * @param {AbortSignal} [signal] - cancels the probe.
   * @returns {Promise<any>} the business result.
   */
  async remoteStatus(signal) {
    return this.provider.status(signal);
  }

  /**
   * Remote `list`.
   *
   * @param {any} [parent] - `{ driveId, fileId }`.
   * @param {string} [cursor] - opaque cursor.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the business result.
   */
  async remoteList(parent, cursor, signal) {
    return this.provider.list(parent, cursor, signal);
  }

  /**
   * Remote `rename`.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the entry to rename.
   * @param {string} newName - the new name, with or without its extension.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the renamed entry.
   */
  async remoteRename(ref, newName, signal) {
    return this.provider.rename(ref, newName, signal);
  }

  /**
   * Remote `listView`.
   *
   * @param {import('./types.js').KDocsView} view - which view to list.
   * @param {string} [cursor] - `nextCursor` from a previous page.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the business result.
   */
  async remoteListView(view, cursor, signal) {
    return this.provider.listView(view, cursor, signal);
  }

  /**
   * Remote `listVersions`.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the document.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the version lines.
   */
  async remoteListVersions(ref, signal) {
    return this.provider.listVersions(ref, signal);
  }

  /**
   * Remote `listComments`.
   *
   * @param {import('./types.js').KDocsFileRef} ref - the document.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the annotation lines.
   */
  async remoteListComments(ref, signal) {
    return this.provider.listComments(ref, signal);
  }

  /**
   * Remote `search`.
   *
   * @param {string} query - search keyword.
   * @param {string} [cursor] - `nextCursor` from a previous page.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the business result.
   */
  async remoteSearch(query, cursor, options, signal) {
    return this.provider.search(query, cursor, options, signal);
  }

  /**
   * Remote `stat`.
   *
   * @param {any} ref - `{ driveId, fileId }`.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the business result.
   */
  async remoteStat(ref, signal) {
    return this.provider.stat(ref, signal);
  }

  /**
   * Remote `read`.
   *
   * @param {any} ref - `{ driveId, fileId }`.
   * @param {any} [options] - extraction options.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the business result.
   */
  async remoteRead(ref, options, signal) {
    return this.provider.read(ref, options ?? {}, signal);
  }

  /**
   * Remote `getLink`.
   *
   * @param {any} ref - `{ driveId, fileId }`.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<any>} the business result.
   */
  async remoteGetLink(ref, signal) {
    return this.provider.getLink(ref, signal);
  }

}
