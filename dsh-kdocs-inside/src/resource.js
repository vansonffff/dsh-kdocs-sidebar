/**
 * The `kdocs` resource protocol: `dsh-resource://kdocs/file/<driveId>/<fileId>`.
 *
 * ## What a resource value is, and is not
 *
 * A resource value is **metadata only** — identity plus what a Tab needs to
 * render a title and pick a viewer. It deliberately excludes the document body:
 *
 * - A Word report can be hundreds of kilobytes of extracted Markdown. Putting
 *   that in a resource snapshot would make every subscription, pin, and React
 *   re-render carry it.
 * - The official `file` provider draws the same line: its value is a
 *   `WorkspaceFileStat`, and content is fetched separately.
 *
 * Consumers read the body through `remote.kdocs.read(...)` when they actually
 * need it — which is exactly what M6's preview Tab will do.
 *
 * ## Address identity
 *
 * `driveId` + `fileId` are the identity, matching `KDocsFileRef`. A file *name*
 * and a `https://kdocs.cn/l/...` share link are both mutable (rename, re-share)
 * and never appear in an address.
 *
 * ## Freshness
 *
 * The provider yields the `stat` result and then ends the stream: a cloud
 * document's metadata does not change underneath the user the way a local file
 * does, and polling `kdocs-cli` would risk the backend's rate limits. The
 * resource model keeps the last value after the stream ends, so a Tab still
 * renders. A future revision can add a slow re-stat without changing this
 * address grammar or the value type.
 *
 * The provider logic here is mirrored inside `client.js`, which cannot import
 * this module — see that file's header.
 *
 * @module kdocs/resource
 */

/**
 * The protocol key, i.e. the host part of every address this module serves.
 */
export const KDOCS_RESOURCE_PROTOCOL = 'kdocs';

/**
 * The address segment naming a document, so a later revision can add other
 * segments (for example a folder address) without re-reading existing ones.
 */
export const KDOCS_RESOURCE_KIND = 'file';

/** The one scheme a resource address may use. */
const SCHEME = 'dsh-resource:';

/**
 * `driveId` and `fileId` are opaque backend identifiers: base64-ish, URL-safe,
 * and never containing a slash. Restricted here so a crafted address cannot
 * smuggle a traversal or an extra segment into the CLI call.
 */
const IDENTIFIER = /^[A-Za-z0-9_-]+$/;

/**
 * Build the address of one document.
 *
 * @param {import('./types.js').KDocsFileRef} ref - the document's identity.
 * @returns {string} the resource address.
 * @throws {TypeError} when either identifier is not a usable opaque id.
 */
export function kdocsAddressOf(ref) {
  if (typeof ref?.driveId !== 'string' || !IDENTIFIER.test(ref.driveId)) {
    throw new TypeError(`kdocs: driveId ${JSON.stringify(ref?.driveId)} is not a usable drive identifier`);
  }
  if (typeof ref?.fileId !== 'string' || !IDENTIFIER.test(ref.fileId)) {
    throw new TypeError(`kdocs: fileId ${JSON.stringify(ref?.fileId)} is not a usable file identifier`);
  }
  return `${SCHEME}//${KDOCS_RESOURCE_PROTOCOL}/${KDOCS_RESOURCE_KIND}/${ref.driveId}/${ref.fileId}`;
}

/**
 * Parse an address back into the document it names.
 *
 * Uses the platform URL parser rather than string splitting so percent-encoding
 * and query/fragment noise are handled the same way the resource model handles
 * them when it computes the protocol.
 *
 * @param {unknown} address - the full address, scheme included.
 * @returns {import('./types.js').KDocsFileRef | undefined} the identity, or undefined when the address is not one this protocol serves.
 */
export function parseKDocsAddress(address) {
  if (typeof address !== 'string' || !address.startsWith(SCHEME)) return undefined;
  /** @type {URL} */
  let url;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  if (url.hostname !== KDOCS_RESOURCE_PROTOCOL) return undefined;

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length !== 3) return undefined;
  const [kind, driveId, fileId] = segments;
  if (kind !== KDOCS_RESOURCE_KIND) return undefined;
  if (!IDENTIFIER.test(driveId) || !IDENTIFIER.test(fileId)) return undefined;
  return { driveId, fileId };
}

/**
 * Web hosts whose document URLs `kdocs-cli` accepts directly.
 *
 * Only the share-link form qualifies. **`https://www.kdocs.cn/l/<fileId>?f=<driveId>`
 * — the form this plugin builds for its own embed — is NOT one of them**: measured
 * against the live CLI it returns `400100 第三方服务错误`, while `/l/<link_id>`
 * succeeds. That asymmetry is why the plugin's canonical handle stays the
 * `dsh-resource://` address, and why this parser only exists as a convenience for
 * a link a user pasted.
 */
const KDOCS_WEB_HOSTS = new Set(['www.kdocs.cn', 'kdocs.cn']);

/**
 * Parse one user- or model-supplied document handle into a locator.
 *
 * Two shapes are accepted, in this order of preference:
 *
 * 1. `dsh-resource://kdocs/file/<driveId>/<fileId>` — the plugin's canonical
 *    identity, and the only one that needs no network round trip to resolve.
 * 2. An `https://www.kdocs.cn/l/<link_id>` share link, handed to the CLI as-is.
 *
 * @param {unknown} text - the candidate handle.
 * @returns {{ ref: import('./types.js').KDocsFileRef } | { url: string } | undefined}
 *   the locator, or undefined when the text names neither form.
 */
export function parseKDocsLocator(text) {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (trimmed === '') return undefined;

  const ref = parseKDocsAddress(trimmed);
  if (ref !== undefined) return { ref };

  /** @type {URL} */
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (!KDOCS_WEB_HOSTS.has(url.hostname)) return undefined;
  // The path has to name a document; a bare host is not a locator.
  if (!/^\/l\/[A-Za-z0-9_-]+$/.test(url.pathname)) return undefined;
  return { url: trimmed };
}

/**
 * Read a Remote result without assuming its shape.
 *
 * The Client API is documented to wrap every call as `{ ok, value }`, but a
 * consumer that also receives direct host calls must not bet on it — a bare
 * value and a successful envelope mean the same thing here.
 *
 * @param {any} result - whatever the Remote call resolved to.
 * @returns {{ ok: boolean, value?: any, error?: any }} the normalized result.
 */
export function unwrapResult(result) {
  if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
    return result.ok === true
      ? { ok: true, value: result.value }
      : { ok: false, error: result.error ?? { code: 'unknown', message: 'remote call failed' } };
  }
  return { ok: true, value: result };
}

/**
 * Narrow one stat result into the resource value.
 *
 * @param {import('./types.js').KDocsEntry} entry - the entry the Host returned.
 * @returns {import('./types.js').KDocsResource} the metadata-only resource value.
 */
export function toResourceValue(entry) {
  /** @type {import('./types.js').KDocsResource} */
  const value = {
    driveId: entry.ref.driveId,
    fileId: entry.ref.fileId,
    name: entry.name,
    kind: entry.kind,
  };
  if (entry.extension !== undefined) value.extension = entry.extension;
  if (entry.modifiedAt !== undefined) value.modifiedAt = entry.modifiedAt;
  if (entry.size !== undefined) value.size = entry.size;
  return value;
}

/**
 * Build a failure frame for an address this protocol does not serve.
 *
 * The error is structurally a `RemoteError` (an `isDSHRemoteError` marker and a
 * string `code`), which is how the framework identifies one across realms, so a
 * consumer's failure branch treats it like any other frame failure.
 *
 * @param {unknown} address - the offending address.
 * @returns {{ ok: false, error: { code: string, message: string, details: { address: string } } }} the failure frame.
 */
export function unsupportedAddress(address) {
  return {
    ok: false,
    error: {
      code: 'kdocs-resource/unsupported-address',
      message: `${String(address)} is not a dsh-resource://${KDOCS_RESOURCE_PROTOCOL}/${KDOCS_RESOURCE_KIND}/<driveId>/<fileId> address`,
      details: { address: String(address) },
      isDSHRemoteError: true,
    },
  };
}

/**
 * Create the `kdocs` resource provider.
 *
 * @param {() => any} remote - resolves the Remote face, whose `stat` this provider calls.
 * @returns {any} the provider to hand to `ctx.resources.register`.
 */
export function createKDocsResourceProvider(remote) {
  return {
    protocol: KDOCS_RESOURCE_PROTOCOL,
    /**
     * Resolve one address to a single metadata frame.
     *
     * A failure is always a **frame**, never a throw: a throw inside the stream
     * is a programming error the resource model deliberately lets surface, so
     * turning an expected backend failure into one would crash a Tab.
     *
     * @param {string} address - the full address.
     * @param {any} [openContext] - the resource layer's per-subscription context,
     *   carrying the `AbortSignal` that ends this open when the last subscriber
     *   goes away.
     * @returns {AsyncGenerator<any, void, unknown>} the frame stream.
     */
    async *open(address, openContext) {
      const ref = parseKDocsAddress(address);
      if (ref === undefined) {
        yield unsupportedAddress(address);
        return;
      }
      // Forwarded, like the browser copy always did. This file is the *exported*
      // provider, and it had drifted: the inline twin in `client.js` was fixed
      // while this one kept calling `stat(ref)` with no signal, so a Node-side
      // consumer could not cancel a subscription at all. The cross-implementation
      // test compared address parsing and result shape — never the call itself.
      const signal = openContext === undefined ? undefined : openContext.signal;
      /** @type {any} */
      let settledFrame;
      try {
        settledFrame = unwrapResult(await remote().stat(ref, signal));
      } catch (error) {
        // Only a closed subscription is swallowed: an expected backend failure
        // arrives as a frame, so a *throw* here is a programming error the resource
        // model is meant to surface. Turning it into a frame would hide exactly the
        // class of mistake this module's contract says must not be hidden.
        if (signal !== undefined && signal.aborted) return;
        throw error;
      }
      const settled = settledFrame;
      if (settled.ok === true) {
        yield { ok: true, value: toResourceValue(settled.value) };
        return;
      }
      // The Remote face already carries a business failure in the seam's own
      // vocabulary, so it is forwarded unchanged — no re-wrapping, no message
      // parsing.
      yield { ok: false, error: settled.error };
    },
  };
}
