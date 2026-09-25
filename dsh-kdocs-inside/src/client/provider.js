/**
 * The `kdocs-cli`-backed Provider for the KDocs capability seam.
 *
 * This is the *only* place in the package that knows the CLI exists. It
 * implements {@link import('../types.js').KDocsProvider} on top of
 * {@link module:kdocs/client/cli}, and in doing so it takes on three
 * responsibilities that no consumer above it should ever repeat:
 *
 * 1. **Credential lifecycle.** `status`, `login`, and `logout` own the CLI's
 *    system-keychain credential. The Provider never reads, stores, or forwards
 *    the token — it asks the CLI what state it is in.
 * 2. **Error translation.** Every failure leaves here as a
 *    {@link import('../errors.js').KDocsError} with a normalized code, so a Tab
 *    or an Agent tool never branches on a numeric backend code.
 * 3. **Pagination and normalization.** The CLI's cursors, envelope depth, and
 *    item shapes stop here; consumers see {@link import('../types.js').KDocsPage}.
 *
 * The Provider deliberately does not retry. Rate limiting (`429001`/`429002`)
 * is surfaced as `'rate-limited'` with `retryAfterMs` set, because the CLI's
 * own guidance is that an immediate retry is the wrong response — the policy
 * decision belongs to the caller, not buried in a loop here.
 *
 * @module kdocs/client/provider
 */

import { KDocsError } from '../errors.js';
import { asRecord, isAbortSignal } from '../internal.js';
import { LOGIN_TIMEOUT_MS, READ_TIMEOUT_MS, authUrlIn, cliVersion, resolveCli, runAction, runCli } from './cli.js';
import {
  envelopeMessage,
  toContentFormat,
  toCursor,
  toEntries,
  toEntry,
  truncateContent,
  unwrapData,
} from './parse.js';

/**
 * How long a fetched status stays fresh.
 *
 * A sidebar opening several panels would otherwise spawn `auth status` once per
 * panel; a few seconds of staleness is invisible, and `login`/`logout`
 * invalidate the cache outright.
 */
const STATUS_TTL_MS = 10_000;

/**
 * Default Provider configuration.
 *
 * @type {Required<KDocsProviderOptions>}
 */
const DEFAULTS = {
  defaultTimeoutMs: 60_000,
  readTimeoutMs: READ_TIMEOUT_MS,
  loginTimeoutMs: LOGIN_TIMEOUT_MS,
  maxContentBytes: 512 * 1024,
  statusTtlMs: STATUS_TTL_MS,
  pageSize: 100,
  exportPollIntervalMs: 1_500,
  exportTimeoutMs: 90_000,
  pdfCacheMax: 20,
};

/**
 * @typedef {object} KDocsProviderOptions
 * @property {number} [defaultTimeoutMs] - ceiling for ordinary calls.
 * @property {number} [readTimeoutMs] - ceiling for content extraction.
 * @property {number} [loginTimeoutMs] - ceiling for the browser OAuth round trip.
 * @property {number} [maxContentBytes] - budget for one extracted body before it is truncated.
 * @property {number} [statusTtlMs] - how long a status observation stays fresh.
 * @property {number} [pageSize] - entries requested per listing/search page (the CLI allows 1–500).
 * @property {number} [exportPollIntervalMs] - gap between `wps.query-export` polls.
 * @property {number} [exportTimeoutMs] - ceiling for one PDF export, polls included.
 * @property {number} [pdfCacheMax] - exported PDFs kept in memory before the oldest is evicted.
 */

/**
 * Options for {@link KDocsCliProvider.read}.
 *
 * Spreadsheet extraction needs a target region; passing neither field keeps the
 * CLI's default (the first screen for a sheet, the whole document otherwise).
 *
 * @typedef {object} KDocsReadOptions
 * @property {string} [sheetName] - worksheet or data-table name.
 * @property {number} [sheetId] - worksheet id; wins over `sheetName` when both are given.
 * @property {{ rowFrom: number, rowTo: number, colFrom: number, colTo: number }} [sheetRange] - 0-based inclusive region.
 * @property {boolean} [allowMediaUrls] - whether embedded images become download URLs (default false).
 * @property {string} [taskId] - resume an extraction the CLI reported as pending.
 */

/**
 * KDocs capability Provider backed by the `kdocs-cli` binary.
 *
 * @implements {import('../types.js').KDocsProvider}
 */
export class KDocsCliProvider {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - owning Cordis context, used for logging.
   * @param {KDocsProviderOptions} [options] - Provider configuration.
   */
  constructor(ctx, options = {}) {
    /** @type {import('@deepseek-ai/cordis').Context} */
    this.ctx = ctx;
    /** @type {Required<KDocsProviderOptions>} */
    this.options = { ...DEFAULTS, ...options };
    /** @type {{ value: import('../types.js').KDocsStatus, at: number } | undefined} */
    this.statusCache = undefined;
    /** @type {string | undefined} */
    this.versionCache = undefined;
    /**
     * Exported PDFs, keyed `driveId/fileId`. The bytes live here rather than on
     * disk: the export is a signed-URL download that expires in minutes, the
     * panel re-reads on every refresh anyway, and a temp file would only add a
     * cleanup problem. Evicted oldest-first past `pdfCacheMax`.
     *
     * @type {Map<string, { base64: string, size: number, exportedAt: string }>}
     */
    this.pdfCache = new Map();
  }

  /** Drop cached observations, so the next read asks the CLI again. */
  invalidate() {
    this.statusCache = undefined;
  }

  /**
   * Observe installation and authentication state.
   *
   * A missing CLI is reported as a status rather than thrown, because "not
   * installed" is a state a Settings panel must be able to render.
   *
   * @param {AbortSignal} [signal] - cancels the probe.
   * @returns {Promise<import('../types.js').KDocsStatus>} the current status.
   */
  async status(signal) {
    const cached = this.statusCache;
    if (cached !== undefined && Date.now() - cached.at < this.options.statusTtlMs) return cached.value;

    const { path } = resolveCli();
    /** @type {import('../types.js').KDocsStatus} */
    let value;

    try {
      const outcome = await runCli(['auth', 'status'], {
        signal,
        timeoutMs: 30_000,
        operation: 'auth.status',
      });
      const payload = outcome.data;
      const record = typeof payload === 'object' && payload !== null
        ? /** @type {Record<string, unknown>} */ (payload)
        : {};
      const keychain = typeof record.keychain === 'object' && record.keychain !== null
        ? /** @type {Record<string, unknown>} */ (record.keychain)
        : undefined;
      const authenticated = record.authenticated === true;

      value = {
        authenticated,
        cliAvailable: true,
        source: toCredentialSource(record.source, authenticated),
        checkedAt: new Date().toISOString(),
      };
      if (path !== undefined) value.cliPath = path;
      if (keychain !== undefined) {
        value.keychainAvailable = keychain.available === true;
        if (typeof keychain.backend === 'string') value.keychainBackend = keychain.backend;
      }
      if (!authenticated) value.reason = 'kdocs-cli 报告未登录';
    } catch (error) {
      if (!KDocsError.is(error)) throw error;
      if (error.code === 'aborted') throw error;

      if (error.code === 'cli-not-installed') {
        value = {
          authenticated: false,
          cliAvailable: false,
          source: 'none',
          checkedAt: new Date().toISOString(),
          reason: error.message,
        };
      } else {
        value = {
          authenticated: false,
          cliAvailable: true,
          source: 'none',
          checkedAt: new Date().toISOString(),
          reason: error.message,
        };
      }
      if (path !== undefined) value.cliPath = path;
    }

    const version = await cliVersion({ signal });
    if (version !== undefined) {
      this.versionCache = version;
      value.cliVersion = version;
    } else if (this.versionCache !== undefined) {
      value.cliVersion = this.versionCache;
    }

    this.statusCache = { value, at: Date.now() };
    return value;
  }

  /**
   * Run the browser OAuth login flow.
   *
   * The CLI prints an authorization URL and then blocks until the browser
   * confirms; it does not open a browser itself. The URL is therefore surfaced
   * through `onEvent` so the caller can present or open it.
   *
   * @param {(event: import('../types.js').KDocsLoginEvent) => void} [onEvent] - receives URL and terminal events.
   * @param {AbortSignal} [signal] - abandons the flow.
   * @returns {Promise<import('../types.js').KDocsStatus>} status after the flow.
   * @throws {KDocsError} when login fails, times out, or is aborted.
   */
  async login(onEvent, signal) {
    let announced = false;
    /** @type {string | undefined} */
    let sawUrl;

    try {
      await runCli(['auth', 'login'], {
        signal,
        timeoutMs: this.options.loginTimeoutMs,
        operation: 'auth.login',
        onStdout: (chunk) => {
          if (announced) return;
          const url = authUrlIn(chunk);
          if (url !== undefined) {
            announced = true;
            sawUrl = url;
            onEvent?.({ kind: 'url', url });
          }
        },
      });
    } catch (error) {
      onEvent?.({ kind: 'failed', reason: KDocsError.is(error) ? error.message : String(error) });
      throw error;
    }

    this.invalidate();
    const status = await this.status(signal);
    if (!status.authenticated) {
      const reason = sawUrl === undefined
        ? '登录流程已结束，但 kdocs-cli 仍报告未登录'
        : '登录流程已结束，但未取得有效凭据（可能在浏览器中取消了授权）';
      onEvent?.({ kind: 'failed', reason });
      throw new KDocsError('not-authenticated', { operation: 'auth.login', message: reason });
    }

    onEvent?.({ kind: 'succeeded' });
    return status;
  }

  /**
   * Drop the stored credential.
   *
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('../types.js').KDocsStatus>} status after logout.
   */
  async logout(signal) {
    await runCli(['auth', 'logout'], { signal, timeoutMs: 30_000, operation: 'auth.logout' });
    this.invalidate();
    return this.status(signal);
  }

  /**
   * List a container, or the drive root.
   *
   * The CLI addresses the personal drive root with a different command than a
   * folder, and rejects `parent_id: "0"` for the root; that distinction is
   * absorbed here so a caller only ever passes "a folder, or nothing".
   *
   * @param {import('../types.js').KDocsFileRef} [parent] - folder to list; omitted means the drive root.
   * @param {string} [cursor] - opaque cursor from a previous page.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('../types.js').KDocsPage>} one page of entries.
   */
  async list(parent, cursor, signal) {
    /** @type {Record<string, unknown>} */
    const params = { page_size: this.options.pageSize };
    if (cursor !== undefined && cursor !== '') params.page_token = cursor;

    let outcome;
    if (parent === undefined) {
      outcome = await runAction('drive', 'list-my-files', params, {
        signal,
        timeoutMs: this.options.defaultTimeoutMs,
      });
    } else {
      params.parent_id = parent.fileId;
      if (parent.driveId !== '') params.drive_id = parent.driveId;
      outcome = await runAction('drive', 'list-files', params, {
        signal,
        timeoutMs: this.options.defaultTimeoutMs,
      });
    }

    const payload = asRecord(outcome.data);
    const fallbackDriveId = typeof payload.drive_id === 'string' ? payload.drive_id : parent?.driveId;
    const entries = toEntries(payload.items, fallbackDriveId);

    /** @type {import('../types.js').KDocsPage} */
    const page = { entries };
    const next = toCursor(payload);
    if (next !== undefined) page.nextCursor = next;
    if (parent !== undefined) page.parent = parent;
    return page;
  }

  /**
   * Search across drives by keyword.
   *
   * @param {string} query - search keyword.
   * @param {string} [cursor] - `nextCursor` from a previous page.
   * @param {import('../types.js').KDocsSearchOptions} [options] - what to narrow.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('../types.js').KDocsSearchResult>} matching entries and paging state.
   */
  async search(query, cursor, options, signal) {
    if (typeof query !== 'string' || query.trim() === '') {
      throw new KDocsError('invalid-request', { operation: 'drive.search-files', message: '搜索关键词不能为空' });
    }
    const narrowed = options === null || typeof options !== 'object' ? {} : options;
    /** @type {Record<string, unknown>} */
    const params = { keyword: query, page_size: this.options.pageSize };
    if (typeof cursor === 'string' && cursor !== '') params.page_token = cursor;
    // Only send what was asked for: the CLI treats an absent parameter and an empty
    // one differently for several of these, and an empty `file_exts` would narrow
    // the search to nothing rather than leave it alone.
    if (narrowed.type !== undefined) params.type = narrowed.type;
    if (Array.isArray(narrowed.fileExts) && narrowed.fileExts.length > 0) params.file_exts = narrowed.fileExts;
    if (narrowed.timeType !== undefined) params.time_type = narrowed.timeType;
    if (typeof narrowed.startTime === 'number') params.start_time = narrowed.startTime;
    if (typeof narrowed.endTime === 'number') params.end_time = narrowed.endTime;
    if (narrowed.withTotal === true) params.with_total = true;
    const outcome = await runAction(
      'drive',
      'search-files',
      params,
      { signal, timeoutMs: this.options.defaultTimeoutMs },
    );
    const payload = asRecord(outcome.data);

    /** @type {import('../types.js').KDocsSearchResult} */
    const result = { entries: toEntries(payload.items) };
    const next = toCursor(payload);
    if (next !== undefined) result.nextCursor = next;
    // Only when it was asked for. Unasked, the CLI answers `total: 0` — measured —
    // which is "not counted", not "nothing matched", and passing that through would
    // tell a caller the drive is empty.
    if (narrowed.withTotal === true && typeof payload.total === 'number') result.total = payload.total;
    return result;
  }

  /**
   * Fetch one entry's metadata.
   *
   * @param {import('../types.js').KDocsLocator} locator - the entry to stat, by identity or by link.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('../types.js').KDocsEntry>} the entry.
   * @throws {KDocsError} with `'not-found'` when the file does not exist.
   */
  async stat(locator, signal) {
    const params = locatorParams(locator, 'drive.get-file-info');
    const outcome = await runAction(
      'drive',
      'get-file-info',
      params,
      { signal, timeoutMs: this.options.defaultTimeoutMs },
    );
    const payload = asRecord(outcome.data);
    // The response carries the identity even when the caller supplied only a
    // link, so a URL is an entry point rather than a parallel identity system.
    const entry = toEntry(payload, locator === null || typeof locator !== 'object' ? undefined : locator.driveId);
    if (entry === undefined) {
      throw new KDocsError('malformed-response', {
        operation: 'drive.get-file-info',
        message: 'kdocs-cli 未返回可识别的文件信息',
      });
    }
    return entry;
  }

  /**
   * List one of the drive's non-tree views.
   *
   * One method rather than four, because the layers above only ever need "the
   * entries of view X" — four Remote methods would mean four descriptors, four
   * schemas, four client-table rows and four places to drift, for data that is
   * shaped identically. The CLI actions behind them differ; that difference stops
   * here.
   *
   * `trash` is the one view whose source is not a search: `list-deleted-files`
   * returns its entries flat rather than wrapped in `{ file }`, which
   * {@link toEntries} already absorbs.
   *
   * @param {import('../types.js').KDocsView} view - which view to list.
   * @param {string} [cursor] - `nextCursor` from a previous page.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('../types.js').KDocsPage>} one page of that view.
   * @throws {KDocsError} with `'invalid-request'` for an unknown view.
   */
  async listView(view, cursor, signal) {
    const source = VIEW_SOURCES[view];
    if (source === undefined) {
      throw new KDocsError('invalid-request', {
        operation: 'drive.list-view',
        message: `未知的视图「${String(view)}」；可用：${Object.keys(VIEW_SOURCES).join(' / ')}`,
      });
    }
    /** @type {Record<string, unknown>} */
    const params = { page_size: this.options.pageSize, ...source.params };
    if (typeof cursor === 'string' && cursor !== '') params.page_token = cursor;

    const outcome = await runAction('drive', source.action, params, {
      signal,
      timeoutMs: this.options.defaultTimeoutMs,
    });
    const payload = asRecord(outcome.data);

    /** @type {import('../types.js').KDocsPage} */
    const page = { entries: toEntries(payload.items) };
    const next = toCursor(payload);
    if (next !== undefined) page.nextCursor = next;
    return page;
  }

  /**
   * List one document's saved versions.
   *
   * Read-only, and deliberately one page: a version list is a glance, not a
   * browser, and the CLI pages it the same way the drive does. Each line carries
   * what a reader decides on — when it was saved, by whom, and how big it was.
   *
   * @param {import('../types.js').KDocsFileRef} ref - the document.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<{ lines: string[] }>} one line per version, newest first.
   */
  async listVersions(ref, signal) {
    requireRef(ref, 'drive.list-file-versions');
    const outcome = await runAction(
      'drive',
      'list-file-versions',
      { file_id: ref.fileId, page_size: this.options.pageSize },
      { signal, timeoutMs: this.options.defaultTimeoutMs },
    );
    const payload = asRecord(outcome.data);
    const items = Array.isArray(payload.items) ? payload.items : [];
    const lines = items.map((item) => {
      const record = asRecord(item);
      const version = typeof record.version === 'string' || typeof record.version === 'number'
        ? String(record.version)
        : '?';
      // `mtime` is Unix seconds (the CLI's own unit throughout), rendered as an
      // ISO instant so a reader can compare it with anything else on screen.
      const when = typeof record.mtime === 'number' && Number.isFinite(record.mtime)
        ? new Date(record.mtime * 1000).toISOString()
        : undefined;
      const who = asRecord(record.modified_by).name;
      const size = typeof record.size === 'number' ? `${String(record.size)} B` : undefined;
      return [version, when, typeof who === 'string' ? who : undefined, size]
        .filter((part) => part !== undefined)
        .join(' · ');
    });
    return { lines };
  }

  /**
   * List the annotations anchored in one document's body.
   *
   * These are the *inline* annotations — the ones a reader makes by selecting a
   * passage — not the bottom-of-page message panel. The CLI keeps them in two
   * separate stores and its own help says not to mix them.
   *
   * The item shape here is taken from a real response, not from documentation: a
   * comment carries `author`, `date`, and `blocks`, and its text is the `text` of
   * the runs inside each block's `para`. A document whose annotations are switched
   * off answers with an upstream refusal rather than an empty list; that message is
   * passed through unchanged, because it already says what a reader needs to know.
   *
   * @param {import('../types.js').KDocsFileRef} ref - the document.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<{ lines: string[] }>} one line per annotation, as returned.
   */
  async listComments(ref, signal) {
    requireRef(ref, 'drive.get-file-inline-comments');
    const outcome = await runAction(
      'drive',
      'get-file-inline-comments',
      { file_id: ref.fileId },
      { signal, timeoutMs: this.options.defaultTimeoutMs },
    );
    const payload = asRecord(outcome.data);
    const items = Array.isArray(payload.inline_comments) ? payload.inline_comments : [];
    const lines = items.map((item) => {
      const record = asRecord(item);
      const blocks = Array.isArray(record.blocks) ? record.blocks : [];
      const text = blocks
        .map((block) => {
          const para = asRecord(asRecord(block).para);
          const runs = Array.isArray(para.runs) ? para.runs : [];
          return runs.map((run) => (typeof asRecord(run).text === 'string' ? asRecord(run).text : '')).join('');
        })
        .join(' ')
        .trim();
      const author = typeof record.author === 'string' ? record.author : undefined;
      const date = typeof record.date === 'string' ? record.date : undefined;
      return [date, author, text === '' ? '（无正文）' : text]
        .filter((part) => part !== undefined)
        .join(' · ');
    });
    return { lines };
  }

  /**
   * Rename one file or folder.
   *
   * **This is a write, and it is the only one this plugin performs.** Two rules
   * follow from that and are enforced here rather than left to the caller:
   *
   * 1. Nothing calls this implicitly. There is no retry, no fallback and no path
   *    that reaches it except an explicit user action, because `kdocs-cli` has no
   *    delete command — a name changed by mistake cannot be undone from here.
   * 2. The extension is preserved, not trusted. The CLI requires `dst_name` to
   *    carry one and rejects the write without it, and a rename that silently
   *    drops `.docx` would change what the file *is* rather than what it is called.
   *
   * @param {import('../types.js').KDocsFileRef} ref - the entry to rename.
   * @param {string} newName - the new name, with or without its extension.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<import('../types.js').KDocsEntry>} the renamed entry.
   * @throws {KDocsError} with `'invalid-request'` when the name is unusable.
   */
  async rename(ref, newName, signal) {
    requireRef(ref, 'drive.rename-file');
    const requested = typeof newName === 'string' ? newName.trim() : '';
    if (requested === '') {
      throw new KDocsError('invalid-request', {
        operation: 'drive.rename-file',
        message: '新名称不能为空。',
      });
    }
    // A separator would make this a move, which is a different (unapproved) action.
    if (/[\\/]/.test(requested)) {
      throw new KDocsError('invalid-request', {
        operation: 'drive.rename-file',
        message: '名称中不能包含路径分隔符。重命名不会移动文件。',
      });
    }

    // The current name carries the extension the backend wants back.
    const current = await this.stat(ref, signal);
    const extension = current.extension ?? '';
    const alreadyHasIt = extension !== '' && requested.toLowerCase().endsWith(`.${extension.toLowerCase()}`);
    const dstName = extension === '' || alreadyHasIt ? requested : `${requested}.${extension}`;

    await runAction(
      'drive',
      'rename-file',
      { file_id: ref.fileId, dst_name: dstName },
      { signal, timeoutMs: this.options.defaultTimeoutMs },
    );
    // Re-read rather than assembling an entry: the backend decides the final name,
    // and a caller that renders a guess would show a name the drive does not have.
    return this.stat(ref, signal);
  }

  /**
   * Extract a document's semantic body.
   *
   * Supports both the plan's `read(ref, signal)` and an options-bearing
   * `read(ref, options, signal)`; the second argument is recognized by shape, so
   * spreadsheets can request a region without complicating the common call.
   *
   * @param {import('../types.js').KDocsLocator} locator - the document to read, by identity or by link.
   * @param {KDocsReadOptions | AbortSignal} [optionsOrSignal] - read options, or the abort signal.
   * @param {AbortSignal} [maybeSignal] - abort signal when options were passed.
   * @returns {Promise<import('../types.js').KDocsContent>} the extracted body.
   * @throws {KDocsError} with `'unsupported'` when the type has no extractable body.
   */
  async read(locator, optionsOrSignal, maybeSignal) {
    const options = isAbortSignal(optionsOrSignal) ? {} : (optionsOrSignal ?? {});
    const signal = isAbortSignal(optionsOrSignal) ? optionsOrSignal : maybeSignal;
    const identity = locator === null || typeof locator !== 'object' ? undefined : locator;

    /** @type {Record<string, unknown>} */
    const params = locatorParams(locator, 'drive.read-file');
    // Embedded media are left as references: the seam returns semantic text,
    // and a document's inline images are not part of that contract.
    params.enable_upload_medias = options.allowMediaUrls === true;
    if (options.taskId !== undefined) params.task_id = options.taskId;
    if (options.sheetName !== undefined) params.sheet_name = options.sheetName;
    if (options.sheetId !== undefined) params.sheet_id = options.sheetId;
    if (options.sheetRange !== undefined) {
      params.sheet_range = {
        row_from: options.sheetRange.rowFrom,
        row_to: options.sheetRange.rowTo,
        col_from: options.sheetRange.colFrom,
        col_to: options.sheetRange.colTo,
      };
    }

    const outcome = await runAction('drive', 'read-file', params, {
      signal,
      timeoutMs: this.options.readTimeoutMs,
    });
    const payload = asRecord(outcome.data);

    const status = typeof payload.status === 'string' ? payload.status : 'ok';
    const name = typeof payload.name === 'string' ? payload.name : (identity?.fileId ?? identity?.url ?? '');
    // A link read reports the identities it resolved to, which is what makes a
    // quoted link a usable handle for every later call.
    const resolvedRef = {
      driveId: typeof payload.drive_id === 'string' ? payload.drive_id : identity?.driveId,
      fileId: typeof payload.file_id === 'string' && payload.file_id !== ''
        ? payload.file_id
        : identity?.fileId,
    };
    // Only reachable when a link was read and the response named no identity: the
    // body arrived but nothing downstream could point at it again.
    if (typeof resolvedRef.fileId !== 'string' || resolvedRef.fileId === '') {
      throw new KDocsError('malformed-response', {
        operation: 'drive.read-file',
        message: 'kdocs-cli 返回了正文但未给出文件标识，无法再引用该文档',
      });
    }

    if (status !== 'ok') {
      // Extraction is asynchronous on some backends: the CLI returns a task id
      // to resume with. That is a *pending* result, not a failure, so it comes
      // back as content the caller can re-request — otherwise a caller could not
      // tell "still parsing" from "cannot parse".
      const taskId = typeof payload.task_id === 'string' ? payload.task_id : undefined;
      /** @type {import('../types.js').KDocsContent} */
      const pending = {
        ref: resolvedRef,
        name,
        format: 'unsupported',
        content: taskId === undefined
          ? `文档仍在解析中（status=${status}），且金山文档未返回 taskId；请稍后重试。`
          : `文档仍在解析中（status=${status}）。请携带 taskId 重新调用 read 以取得正文。`,
        truncated: false,
      };
      if (taskId !== undefined) pending.taskId = taskId;
      return pending;
    }

    const rawContent = typeof payload.content === 'string' ? payload.content : '';
    const { content, truncated } = truncateContent(rawContent, this.options.maxContentBytes);

    /** @type {import('../types.js').KDocsContent} */
    const result = {
      ref: resolvedRef,
      name,
      format: toContentFormat(payload.content_format),
      content,
      truncated,
    };
    if (typeof payload.task_id === 'string') result.taskId = payload.task_id;
    return result;
  }

  /**
   * The document's online WPS URL, for "open in 金山文档".
   *
   * @param {import('../types.js').KDocsFileRef} ref - the document.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<string>} the share URL.
   * @throws {KDocsError} with `'malformed-response'` when no URL comes back.
   */
  async getLink(ref, signal) {
    requireRef(ref, 'drive.get-file-link');
    const outcome = await runAction(
      'drive',
      'get-file-link',
      { file_id: ref.fileId },
      { signal, timeoutMs: this.options.defaultTimeoutMs },
    );
    const payload = asRecord(outcome.data);
    const url = payload.link_url;
    if (typeof url !== 'string' || url === '') {
      throw new KDocsError('malformed-response', {
        operation: 'drive.get-file-link',
        message: 'kdocs-cli 未返回在线链接',
      });
    }
    return url;
  }

  /**
   * Export one document as a PDF and return its bytes, base64-encoded.
   *
   * This is the desktop shell's 原版 substitute: the embedded WPS viewer needs a
   * web session the app's Chromium profile cannot acquire (measured 2026-09-25:
   * the OAuth authorize step 403s and the session cookie never lands in the
   * jar), while this path is authenticated by the CLI token end to end —
   * `wps.export` starts a task, `wps.query-export` polls it, and the result URL
   * is a signed object-store URL that needs no cookie (verified bare: HTTP 200).
   *
   * Bytes cross the wire base64 inside the framework envelope: a 100 KB contract
   * arrives as ~140 KB of text, acceptable for a sidebar preview, and it avoids
   * inventing a file-serving route (which this package must never do).
   *
   * @param {import('../types.js').KDocsFileRef} ref - the document to export.
   * @param {{ refresh?: boolean }} [options] - `refresh: true` bypasses the cache.
   * @param {AbortSignal} [signal] - cancels the call.
   * @returns {Promise<{ base64: string, size: number, exportedAt: string, cached: boolean }>} the PDF payload.
   * @throws {KDocsError} `'timeout'` when the export outlives `exportTimeoutMs`,
   *   `'malformed-response'` when the CLI omits the task or the URL.
   */
  async exportPdf(ref, optionsOrSignal, maybeSignal) {
    const options = isAbortSignal(optionsOrSignal) ? {} : (optionsOrSignal ?? {});
    const signal = isAbortSignal(optionsOrSignal) ? optionsOrSignal : maybeSignal;
    requireRef(ref, 'wps.export');

    const cacheKey = `${ref.driveId}/${ref.fileId}`;
    const cached = this.pdfCache.get(cacheKey);
    if (cached !== undefined && options.refresh !== true) return { ...cached, cached: true };

    const exported = await runAction('wps', 'export', { file_id: ref.fileId, format: 'pdf' }, {
      signal,
      timeoutMs: this.options.defaultTimeoutMs,
    });
    const exportPayload = asRecord(exported.data);
    const taskId = typeof exportPayload.task_id === 'string' ? exportPayload.task_id : undefined;
    if (taskId === undefined) {
      throw new KDocsError('malformed-response', {
        operation: 'wps.export',
        message: 'kdocs-cli 未返回导出任务 ID',
      });
    }
    const taskType = typeof exportPayload.task_type === 'string' ? exportPayload.task_type : 'normal_export';

    const deadline = Date.now() + this.options.exportTimeoutMs;
    /** @type {string | undefined} */
    let downloadUrl;
    for (;;) {
      if (signal?.aborted) {
        throw new KDocsError('aborted', { operation: 'wps.query-export', message: '导出已取消' });
      }
      if (Date.now() > deadline) {
        throw new KDocsError('timeout', {
          operation: 'wps.query-export',
          message: `PDF 导出超过 ${Math.round(this.options.exportTimeoutMs / 1000)} 秒仍未完成`,
          retryAfterMs: this.options.exportPollIntervalMs,
        });
      }
      await sleep(this.options.exportPollIntervalMs, signal);
      const polled = await runAction('wps', 'query-export', { format: 'pdf', task_id: taskId, task_type: taskType }, {
        signal,
        timeoutMs: this.options.defaultTimeoutMs,
      });
      const polledPayload = asRecord(polled.data);
      const status = typeof polledPayload.status === 'string' ? polledPayload.status : '';
      const inner = asRecord(polledPayload.data);
      if (status === 'finished' || inner.result === 'ok') {
        downloadUrl = typeof inner.url === 'string' && inner.url !== '' ? inner.url : undefined;
        break;
      }
      if (status === 'failed' || status === 'error') {
        throw new KDocsError('cli-failed', {
          operation: 'wps.query-export',
          message: `金山文档导出失败（status=${status}）`,
        });
      }
      // Anything else is a pending state; keep polling until the deadline.
    }
    if (downloadUrl === undefined) {
      throw new KDocsError('malformed-response', {
        operation: 'wps.query-export',
        message: '导出完成但 kdocs-cli 未返回下载地址',
      });
    }

    const response = await fetch(downloadUrl, { signal });
    if (!response.ok) {
      throw new KDocsError('cli-failed', {
        operation: 'wps.export.download',
        message: `下载导出的 PDF 失败（HTTP ${response.status}）`,
      });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const result = { base64: buffer.toString('base64'), size: buffer.length, exportedAt: new Date().toISOString() };

    this.pdfCache.delete(cacheKey);
    this.pdfCache.set(cacheKey, result);
    while (this.pdfCache.size > this.options.pdfCacheMax) {
      const oldest = this.pdfCache.keys().next().value;
      this.pdfCache.delete(oldest);
    }
    return { ...result, cached: false };
  }
}

/**
 * Sleep in poll-sized steps, aborting promptly when the caller cancels.
 *
 * @param {number} ms - how long to wait.
 * @param {AbortSignal} [signal] - cancels the wait.
 * @returns {Promise<void>} resolves when the wait ends.
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new KDocsError('aborted', { operation: 'sleep', message: '已取消' }));
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The CLI action behind each non-tree view, and its fixed parameters.
 *
 * Verified against the live CLI: `list-star-items` and `list-latest-items` are
 * dedicated actions, the two share views are `search-files` scoped filters, and
 * the recycle bin is `list-deleted-files`.
 *
 * @type {Readonly<Record<string, { action: string, params: Record<string, unknown> }>>}
 */
const VIEW_SOURCES = Object.freeze({
  starred: { action: 'list-star-items', params: {} },
  recent: { action: 'list-latest-items', params: {} },
  sharedWithMe: { action: 'search-files', params: { scope: ['share_to_me'] } },
  sharedByMe: { action: 'search-files', params: { scope: ['share_by_me'] } },
  trash: { action: 'list-deleted-files', params: {} },
});

/**
 * Reject a call that has no usable identity before it reaches the CLI.
 *
 * @param {import('../types.js').KDocsFileRef | undefined} ref - candidate reference.
 * @param {string} operation - operation label for the error.
 * @throws {KDocsError} with `'invalid-request'` when the reference is unusable.
 */
function requireRef(ref, operation) {
  if (ref === undefined || typeof ref.fileId !== 'string' || ref.fileId === '') {
    throw new KDocsError('invalid-request', { operation, message: '缺少 fileId，无法定位云文档' });
  }
}

/**
 * The CLI's identity parameters for one locator.
 *
 * A ref becomes `file_id`; a link becomes `url` and is resolved by the CLI, whose
 * response then reports the identities it found. That is deliberate — the plugin
 * never has to parse a share link, and a link that turns out to be unreadable
 * fails as an ordinary upstream error instead of as a guess.
 *
 * @param {import('../types.js').KDocsLocator | undefined} locator - the candidate handle.
 * @param {string} operation - operation label for the error.
 * @returns {Record<string, unknown>} `{ file_id }` or `{ url }`.
 * @throws {KDocsError} with `'invalid-request'` when nothing usable was supplied.
 */
function locatorParams(locator, operation) {
  if (locator !== null && typeof locator === 'object') {
    if (typeof locator.url === 'string' && locator.url !== '') return { url: locator.url };
    if (typeof locator.fileId === 'string' && locator.fileId !== '') return { file_id: locator.fileId };
  }
  throw new KDocsError('invalid-request', {
    operation,
    message: '缺少文档标识：请给出 { driveId, fileId }，或一个 dsh-resource://kdocs/file/… 地址或金山文档链接',
  });
}

/**
 * Map the CLI's credential `source` onto the seam's vocabulary.
 *
 * @param {unknown} source - the CLI's reported source.
 * @param {boolean} authenticated - whether a credential is actually present.
 * @returns {import('../types.js').KDocsCredentialSource} the seam source.
 */
function toCredentialSource(source, authenticated) {
  if (!authenticated) return 'none';
  if (source === 'system keychain') return 'keychain';
  if (typeof source === 'string' && source.includes('环境变量')) return 'environment';
  return 'environment';
}

/** Re-exported so tests and diagnostics can assert on the raw envelope message. */
export { envelopeMessage, unwrapData };
