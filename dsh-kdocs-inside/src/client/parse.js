/**
 * Translation from `kdocs-cli` wire shapes into the seam's vocabulary.
 *
 * This module exists because the CLI is *not* internally consistent, and every
 * one of these inconsistencies was observed against the live service rather
 * than assumed:
 *
 * - Envelopes nest to different depths. Extraction commands
 *   (`list-my-files`, `search-files`, `read-file`) put the payload directly in
 *   `data`, while metadata commands (`get-file-info`, `get-file-link`) return
 *   `{ code, data: { code, data: {...} } }`. {@link unwrapData} collapses both.
 * - The error text field is spelled `message` by extraction commands and `msg`
 *   by search. {@link envelopeMessage} reads either.
 * - Item shape differs by command. A listing returns the item directly;
 *   `search-files` wraps it as `{ file, file_src, highlights }`.
 *   {@link toEntry} accepts both.
 * - `ctime`/`mtime` are Unix *seconds*, and folders report `size: 0`, which is
 *   "not applicable" rather than "empty file".
 *
 * Nothing here throws for a merely unexpected field: a shape the seam does not
 * recognize degrades to a missing optional field, because losing a folder to a
 * parse error is worse than losing its modification time.
 *
 * @module kdocs/client/parse
 */

import { extensionOf, instantFromSeconds } from '../types.js';

/**
 * Collapse the CLI's variable envelope nesting down to the actual payload.
 *
 * An inner object is treated as another envelope only when it declares a
 * numeric `code` — that is the discriminator the CLI itself uses, and it keeps
 * a genuine payload that happens to carry a `data` field intact.
 *
 * @param {unknown} value - a `data` value, possibly still enveloped.
 * @returns {unknown} the innermost payload.
 */
export function unwrapData(value) {
  let current = value;
  // Bounded rather than `while (true)`: a malformed response must not spin.
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return current;
    const record = /** @type {Record<string, unknown>} */ (current);
    if (typeof record.code !== 'number' || !('data' in record)) return current;
    current = record.data;
  }
  return current;
}

/**
 * The human-readable failure text from an envelope, whichever field carries it.
 *
 * @param {Record<string, unknown>} envelope - a parsed CLI response.
 * @returns {string | undefined} the message, when present.
 */
export function envelopeMessage(envelope) {
  const candidate = envelope.message ?? envelope.msg;
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined;
}

/**
 * Map the CLI's `type` field onto the seam's entry kind.
 *
 * An unknown type becomes `'shortcut'` rather than `'file'`: the seam must not
 * invite a consumer to treat something it does not understand as a document it
 * can read.
 *
 * @param {unknown} type - the CLI's `type`.
 * @returns {import('../types.js').KDocsEntryKind} the seam kind.
 */
export function toKind(type) {
  if (type === 'folder') return 'directory';
  if (type === 'file') return 'file';
  return 'shortcut';
}

/**
 * Convert one entry from any listing or search response.
 *
 * @param {unknown} item - one item of `items`, possibly a search wrapper.
 * @param {string} [fallbackDriveId] - drive id to use when the item omits one.
 * @returns {import('../types.js').KDocsEntry | undefined} the entry, or undefined when it has no identity.
 */
export function toEntry(item, fallbackDriveId) {
  if (typeof item !== 'object' || item === null) return undefined;
  const record = /** @type {Record<string, unknown>} */ (item);
  // Search results nest the real item; listings present it directly.
  const file = typeof record.file === 'object' && record.file !== null
    ? /** @type {Record<string, unknown>} */ (record.file)
    : record;

  const fileId = file.id;
  if (typeof fileId !== 'string' || fileId === '') return undefined;
  const driveId = typeof file.drive_id === 'string' && file.drive_id !== ''
    ? file.drive_id
    : typeof file.drive_id === 'number'
      ? String(file.drive_id)
      : fallbackDriveId;
  if (driveId === undefined) return undefined;

  const name = typeof file.name === 'string' ? file.name : fileId;
  const kind = toKind(file.type);

  /** @type {import('../types.js').KDocsEntry} */
  const entry = {
    ref: { driveId, fileId },
    name,
    kind,
  };

  // Only files have extensions. A folder may legitimately contain dots
  // (`archive.v1`), and treating the tail as a suffix made `rename` append it
  // back: the user confirmed `archive` and the drive got `archive.v1`.
  const extension = kind === 'file' ? extensionOf(name) : undefined;
  if (extension !== undefined) entry.extension = extension;

  const modifiedAt = instantFromSeconds(file.mtime);
  if (modifiedAt !== undefined) entry.modifiedAt = modifiedAt;

  // A folder reports 0 bytes, which is "not applicable", not "empty".
  if (kind === 'file' && typeof file.size === 'number' && Number.isFinite(file.size) && file.size > 0) {
    entry.size = file.size;
  }

  return entry;
}

/**
 * Convert an `items` array of any response into seam entries.
 *
 * @param {unknown} items - the raw array.
 * @param {string} [fallbackDriveId] - drive id for items that omit one.
 * @returns {import('../types.js').KDocsEntry[]} the converted entries.
 */
export function toEntries(items, fallbackDriveId) {
  if (!Array.isArray(items)) return [];
  const entries = [];
  for (const item of items) {
    const entry = toEntry(item, fallbackDriveId);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

/**
 * Read a pagination cursor from any response that carries one.
 *
 * @param {Record<string, unknown>} payload - an unwrapped payload.
 * @returns {string | undefined} the cursor, absent when the listing is complete.
 */
export function toCursor(payload) {
  const token = payload.next_page_token;
  if (typeof token === 'string' && token !== '') return token;
  return undefined;
}

/**
 * Map the CLI's `content_format` onto the seam's content format.
 *
 * @param {unknown} contentFormat - the CLI's format string.
 * @returns {import('../types.js').KDocsContentFormat} the seam format.
 */
export function toContentFormat(contentFormat) {
  if (contentFormat === 'markdown') return 'markdown';
  if (contentFormat === 'plain' || contentFormat === 'text') return 'text';
  if (contentFormat === 'kdc') return 'kdc';
  return 'text';
}

/**
 * Truncate extracted content to a byte budget, on a line boundary.
 *
 * The CLI has no size limit of its own, so a large document would otherwise
 * arrive whole and fill a Tab or an Agent's context. Cutting at the last
 * complete line keeps the result readable and keeps a multi-byte character from
 * being split in half.
 *
 * @param {string} content - the full extracted body.
 * @param {number} maxBytes - the budget in UTF-8 bytes.
 * @returns {{ content: string, truncated: boolean }} the possibly shortened body.
 */
export function truncateContent(content, maxBytes) {
  const size = Buffer.byteLength(content, 'utf8');
  if (size <= maxBytes) return { content, truncated: false };
  const cut = Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8');
  const lastNewline = cut.lastIndexOf('\n');
  const body = lastNewline > 0 ? cut.slice(0, lastNewline) : cut;
  return { content: body, truncated: true };
}
