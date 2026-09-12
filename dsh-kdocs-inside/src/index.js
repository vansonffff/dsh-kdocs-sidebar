/**
 * KDocs plugin entry point — the Host face of the `kdocs` bundle.
 *
 * `apply` does one thing: register the {@link KDocsService} under `ctx.kdocs`,
 * so that any later-mounted plugin (a right-sidebar browser, an Agent tool, a
 * Case Workspace) can consume the capability without knowing how it is backed.
 *
 * ```
 *   cordis profile layer "kdocs"
 *            |
 *         apply(ctx, config)
 *            |
 *      new KDocsService(ctx, config)   ->   ctx.kdocs
 *            |
 *      KDocsCliProvider                ->   spawn(kdocs-cli, args, {shell:false})
 * ```
 *
 * Swapping `kdocs-cli` for another backend (for example a future personal WPS
 * OpenAPI client) means shipping a different Provider behind the same
 * `ctx.kdocs` name — not editing this file's consumers.
 *
 * Configuration is validated by Cordis against {@link Config}, so a typo in a
 * profile's patch layer fails at boot with a precise message rather than
 * surfacing later as a mysterious timeout.
 *
 * @module kdocs
 */

import Schema from '@deepseek-ai/schemastery';

import { KDocsService, KDOCS_SERVICE_NAME } from './service.js';
import { registerKDocsTools } from './tools.js';

/** Cordis plugin name, matching the `name` used by this package's bundle patch row. */
export const name = 'kdocs';

/**
 * Services this plugin requires before activation.
 *
 * `typert` is the Gateway's local registry: the Remote facade binds itself to it
 * in its constructor, so activation must wait for it to exist. `ctx.kdocs`
 * itself remains dependency-free — a composition that mounted only the seam
 * would not need the Gateway, and this plugin always provides both.
 *
 * @type {string[]}
 */
export const inject = ['typert'];

/**
 * Validated plugin configuration.
 *
 * Every field is optional: the defaults are chosen to be safe for an
 * interactive sidebar (bounded calls, bounded document size) so that mounting
 * the plugin without configuration cannot hang a Tab on a 40 MB spreadsheet.
 */
export const Config = Schema.object({
  /** Ceiling for ordinary calls such as listing, searching, and statting. */
  defaultTimeoutMs: Schema.number().default(60_000),
  /** Ceiling for content extraction, which is materially slower than metadata. */
  readTimeoutMs: Schema.number().default(180_000),
  /** Ceiling for the interactive browser OAuth round trip. */
  loginTimeoutMs: Schema.number().default(330_000),
  /** Budget for one extracted document body before it is truncated on a line boundary. */
  maxContentBytes: Schema.number().default(512 * 1024),
  /** How long an observed auth status stays fresh. */
  statusTtlMs: Schema.number().default(10_000),
  /** Entries requested per listing/search page. */
  pageSize: Schema.number().default(100),
});

/**
 * Mount the KDocs capability.
 *
 * One service is registered, under `ctx.kdocs`. The same object is what the
 * Typert Gateway dispatches `remote.kdocs` calls to, because it extends
 * `TypertRemoteService` and therefore carries the `typertRemote` binding — see
 * {@link module:kdocs/service} for why a separate facade cannot work.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin's context.
 * @param {Partial<import('./client/provider.js').KDocsProviderOptions>} [config] - validated configuration.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const service = new KDocsService(ctx, config);
  ctx.logger?.debug?.(
    `kdocs: registered ctx.${KDOCS_SERVICE_NAME} backed by the kdocs-cli provider, exposed as remote.${KDOCS_SERVICE_NAME}`,
  );
  // Holding the reference makes the registration's owner explicit: Cordis
  // unregisters the service when this plugin's fiber unloads.
  void service;

  // The Agent tools are registered only once the tool runtime is present, and
  // through `ctx.inject` rather than a static `inject` entry: reading
  // `ctx.tools` before it exists would make Cordis refuse this context's access
  // permanently. A composition without a tool runtime simply gets no tools.
  ctx.inject(['tools'], (scoped) => {
    registerKDocsTools(scoped);
    scoped.logger?.debug?.('kdocs: registered kdocs_list/search/read/stat');
  });
}

export { KDocsService, KDOCS_SERVICE_NAME };
export { KDocsError, KDOCS_ERROR_CODES, classifyUpstreamCode, UPSTREAM_CODE_MAP } from './errors.js';
export { extensionOf, instantFromSeconds, isListable } from './types.js';
