/**
 * The wire vocabulary of the KDocs capability seam.
 *
 * Two identity rules hold everywhere in this module:
 *
 * - A file is identified by `driveId` + `fileId`, never by its name and never
 *   by its `https://kdocs.cn/l/...` share link. Names are mutable metadata and
 *   share links are revocable; only the pair addresses the document.
 * - No method here carries document *content* except {@link KDocsContent}.
 *   Browsing, searching, and statting return metadata, so a resource snapshot
 *   built from {@link KDocsEntry} stays small and a full Word body is only ever
 *   fetched by an explicit read.
 *
 * @module kdocs/types
 */

/**
 * Stable identity of one cloud document or folder.
 *
 * `driveId` is the cloud drive the item lives in (the CLI reports
 * `drive_id`; a personal account has a stable numeric id), and `fileId` is
 * the item id inside that drive.
 *
 * @typedef {object} KDocsFileRef
 * @property {string} driveId - cloud drive id.
 * @property {string} fileId - file or folder id within the drive.
 */

/**
 * Anything that names one document to the Provider.
 *
 * A `KDocsFileRef` is the canonical form. `{ url }` exists because a model asked
 * to act on a document the user *quoted into the conversation* may hold a
 * 金山文档 share link rather than parsed identities, and because `kdocs-cli`
 * accepts such a link directly. `stat` and `read` resolve a `{ url }` back into a
 * real ref from the response, so a URL is an entry point rather than a second
 * identity system.
 *
 * @typedef {KDocsFileRef | { url: string }} KDocsLocator
 */

/**
 * A drive view that is not the folder tree.
 *
 * The tree is addressed by `parent`; these are the drive's own curated lists, and
 * they page the same way. They share one accessor because they share one shape —
 * a caller only ever asks for "the entries of this view".
 *
 * @typedef {'starred' | 'recent' | 'sharedWithMe' | 'sharedByMe' | 'trash'} KDocsView
 */

/**
 * Whether an entry names a document or a container.
 *
 * `shortcut` is the CLI's own third item type; it is surfaced verbatim rather
 * than folded into `file`, so a consumer never mistakes a link for a document.
 *
 * @typedef {'file' | 'directory' | 'shortcut'} KDocsEntryKind
 */

/**
 * One entry in a listing or search result: identity plus display metadata.
 *
 * @typedef {object} KDocsEntry
 * @property {KDocsFileRef} ref - stable identity.
 * @property {string} name - display name, including any extension.
 * @property {KDocsEntryKind} kind - document, container, or shortcut.
 * @property {string} [extension] - lowercase extension without the dot, when the name carries one.
 * @property {string} [modifiedAt] - ISO 8601 instant of the last modification.
 * @property {number} [size] - byte size when the backend reports a meaningful one (folders report 0).
 */

/**
 * One page of a directory listing.
 *
 * Pagination is opaque: `nextCursor` is the CLI's `next_page_token` passed back
 * verbatim. An absent `nextCursor` means the listing is complete.
 *
 * @typedef {object} KDocsPage
 * @property {KDocsEntry[]} entries - this page's entries.
 * @property {string} [nextCursor] - cursor for the next page, absent at the end.
 * @property {KDocsFileRef} [parent] - the container these entries were listed under, absent for the drive root.
 */

/**
 * How much of a document a read returned.
 *
 * `'markdown'` and `'text'` are semantic text. `'kdc'` is the CLI's structured
 * representation (used for presentations and spreadsheets); it is not text to
 * render verbatim, but it is still a complete answer to "read this document".
 * `'unsupported'` means the file type has no extractable body.
 *
 * @typedef {'markdown' | 'text' | 'kdc' | 'unsupported'} KDocsContentFormat
 */

/**
 * The body of one document, as semantic content.
 *
 * @typedef {object} KDocsContent
 * @property {KDocsFileRef} ref - the document that was read.
 * @property {string} name - display name at read time.
 * @property {KDocsContentFormat} format - how to interpret {@link KDocsContent.content}.
 * @property {string} content - the extracted body.
 * @property {boolean} truncated - whether the Provider capped the body by its configured budget.
 * @property {string} [taskId] - set when extraction is still running; re-read with this id to continue.
 */

/**
 * A search result together with its paging state.
 *
 * Search is worded differently from {@link KDocsPage} because the CLI requires
 * `page_size` on search and returns a token, whereas a listing may omit both.
 *
 * @typedef {object} KDocsSearchResult
 * @property {KDocsEntry[]} entries - matching entries.
 * @property {string} [nextCursor] - cursor for the next page, absent at the end.
 * @property {number} [total] - how many matches exist, when the caller asked for it.
 */

/**
 * What narrows one search.
 *
 * Every field maps to a `search-files` parameter that was measured working against
 * the live CLI. They are optional as a group: `search(query)` stays the whole call
 * for a caller that wants nothing narrowed.
 *
 * `total` is opt-in because it makes the backend count every match — measured at
 * 2263 for a common term — and that is a different question from "give me a page".
 *
 * @typedef {object} KDocsSearchOptions
 * @property {'all' | 'file_name' | 'content'} [type] - which field to match.
 * @property {string[]} [fileExts] - keep only these extensions.
 * @property {'ctime' | 'mtime' | 'otime' | 'stime'} [timeType] - which timestamp the range applies to.
 * @property {number} [startTime] - earliest timestamp, Unix seconds.
 * @property {number} [endTime] - latest timestamp, Unix seconds.
 * @property {boolean} [withTotal] - also report how many matches exist.
 */

/**
 * The value of a `dsh-resource://kdocs/file/<driveId>/<fileId>` resource.
 *
 * **Metadata only — never the document body.** A resource snapshot is carried
 * through every subscription, pin, and re-render, and an extracted Word report
 * can be hundreds of kilobytes; the body is fetched explicitly through
 * `KDocsProvider.read` when a consumer needs it. This mirrors the official
 * `file` protocol, whose value is a `WorkspaceFileStat` rather than file text.
 *
 * The two identifiers are repeated here rather than left to the address alone so
 * a consumer holding only the value can still address the document.
 *
 * @typedef {object} KDocsResource
 * @property {string} driveId - cloud drive id.
 * @property {string} fileId - file id within that drive.
 * @property {string} name - display name.
 * @property {KDocsEntryKind} kind - document, container, or shortcut.
 * @property {string} [extension] - lowercase extension without the dot.
 * @property {string} [modifiedAt] - ISO 8601 instant of last modification.
 * @property {number} [size] - byte size when the backend reports a meaningful one.
 */

/**
 * Where the CLI is currently reading its credential from.
 *
 * This reports the *source*, never the secret: `'environment'` means a token is
 * present in the process environment only and will not survive a restart.
 *
 * @typedef {'keychain' | 'environment' | 'flag' | 'none'} KDocsCredentialSource
 */

/**
 * Authentication and installation state of the backing CLI.
 *
 * @typedef {object} KDocsStatus
 * @property {boolean} authenticated - whether a token is present and accepted.
 * @property {boolean} cliAvailable - whether the CLI binary was found and executable.
 * @property {string} [cliPath] - absolute path of the resolved binary, absent when it was not found.
 * @property {string} [cliVersion] - the CLI's own reported version.
 * @property {KDocsCredentialSource} source - where the credential came from.
 * @property {boolean} [keychainAvailable] - whether a system keychain backend is usable.
 * @property {string} [keychainBackend] - the keychain backend description, e.g. `system keychain`.
 * @property {string} [checkedAt] - ISO 8601 instant this status was observed.
 * @property {string} [reason] - human-readable explanation when `authenticated` is false.
 */

/**
 * Progress and completion notices emitted while {@link KDocsProvider.login}
 * drives the browser OAuth flow.
 *
 * The login flow is long-running and interactive, so the seam exposes it as
 * events rather than a bare promise: a consumer needs the authorization URL to
 * open a browser, and needs to know when to stop waiting.
 *
 * @typedef {object} KDocsLoginEvent
 * @property {'waiting' | 'url' | 'succeeded' | 'failed'} kind - what happened.
 * @property {string} [url] - authorization URL, on `kind: 'url'`.
 * @property {string} [reason] - failure explanation, on `kind: 'failed'`.
 */

/**
 * The KDocs capability, as consumers (UI, Agent tools, later Case Workspace) see it.
 *
 * Every method accepts an optional `AbortSignal` so a cancelled Tab or tool call
 * stops the underlying CLI process instead of letting it finish unobserved.
 *
 * @typedef {object} KDocsProvider
 * @property {(signal?: AbortSignal) => Promise<KDocsStatus>} status - observe installation and auth state.
 * @property {(listener: (event: KDocsLoginEvent) => void, signal?: AbortSignal) => Promise<KDocsStatus>} login - run the browser OAuth flow, emitting its URL; resolves once authenticated.
 * @property {(signal?: AbortSignal) => Promise<KDocsStatus>} logout - drop the stored credential, then report status.
 * @property {(parent?: KDocsFileRef, cursor?: string, signal?: AbortSignal) => Promise<KDocsPage>} list - list a container, or the drive root when `parent` is omitted.
 * @property {(view: KDocsView, cursor?: string, signal?: AbortSignal) => Promise<KDocsPage>} listView - list one of the drive's curated views.
 * @property {(ref: KDocsFileRef, newName: string, signal?: AbortSignal) => Promise<KDocsEntry>} rename - rename one entry. **The seam's only write.**
 * @property {(ref: KDocsFileRef, signal?: AbortSignal) => Promise<{ lines: string[] }>} listVersions - one document's saved versions, newest first.
 * @property {(ref: KDocsFileRef, signal?: AbortSignal) => Promise<{ lines: string[] }>} listComments - the annotations anchored in one document's body.
 * @property {(query: string, cursor?: string, options?: KDocsSearchOptions, signal?: AbortSignal) => Promise<KDocsSearchResult>} search - search by keyword across drives.
 * @property {(ref: KDocsFileRef, signal?: AbortSignal) => Promise<KDocsEntry>} stat - fetch one entry's metadata.
 * @property {(ref: KDocsFileRef, signal?: AbortSignal) => Promise<KDocsContent>} read - extract one document's semantic body.
 * @property {(ref: KDocsFileRef, signal?: AbortSignal) => Promise<string>} getLink - the document's online WPS URL for "open in 金山文档".
 */

/**
 * The extension a file name carries, lowercased and without the dot.
 *
 * A leading dot with no further dot (`.gitignore`) is not an extension: that
 * would report an empty extension for a dotfile.
 *
 * @param {string} name - display name to inspect.
 * @returns {string | undefined} the extension, or undefined when the name has none.
 */
export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Convert the CLI's Unix-second timestamp into an ISO 8601 instant.
 *
 * The CLI reports `ctime`/`mtime` in seconds; a zero or missing value means the
 * backend had nothing to report and must not become the epoch.
 *
 * @param {unknown} seconds - `ctime`/`mtime` value as received.
 * @returns {string | undefined} ISO instant, or undefined when unusable.
 */
export function instantFromSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Whether an entry is a container that can be listed.
 *
 * @param {KDocsEntry} entry - entry to test.
 * @returns {boolean} true when {@link KDocsProvider.list} accepts this entry as `parent`.
 */
export function isListable(entry) {
  return entry.kind === 'directory';
}
