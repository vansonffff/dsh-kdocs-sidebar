/**
 * The error vocabulary of the KDocs capability seam.
 *
 * The seam's contract is that *no consumer ever parses a CLI failure*. The
 * Provider is the only layer that knows `kdocs-cli`'s numeric `code` values,
 * its exit codes, and its stderr phrasing; everything above it — a right-sidebar
 * Tab, an Agent tool, a later Case Workspace — receives a {@link KDocsError}
 * whose `code` is one of the stable strings below.
 *
 * Two of those rules come straight from the CLI's own guidance and are
 * therefore enforced in the Provider rather than left to callers:
 *
 * - Rate limiting (`429001`, `429002`) must not be retried immediately. These
 *   map to `'rate-limited'` with `retryAfterMs` set, and callers are expected
 *   to wait rather than loop.
 * - An authentication failure means "run `auth login` again", not "retry":
 *   it maps to `'not-authenticated'` and the Provider drops its cached status.
 *
 * @module kdocs/errors
 */

/**
 * Every way a KDocs operation can fail, as a stable string.
 *
 * @typedef {'not-authenticated'
 *   | 'rate-limited'
 *   | 'circuit-open'
 *   | 'not-found'
 *   | 'invalid-request'
 *   | 'permission-denied'
 *   | 'unsupported'
 *   | 'timeout'
 *   | 'aborted'
 *   | 'cli-not-installed'
 *   | 'cli-failed'
 *   | 'malformed-response'
 *   | 'unknown'} KDocsErrorCode
 */

/**
 * What each code means for a caller deciding whether to try again.
 *
 * `retryable` means "the same call may succeed later, after `retryAfterMs`";
 * it never means "call it again immediately".
 *
 * @type {Readonly<Record<KDocsErrorCode, { retryable: boolean, message: string }>>}
 */
export const KDOCS_ERROR_CODES = Object.freeze({
  'not-authenticated': { retryable: false, message: '金山文档未登录，请先执行登录' },
  'rate-limited': { retryable: true, message: '金山文档接口触发限流，请稍后重试' },
  'circuit-open': { retryable: true, message: '金山文档接口暂时熔断，请稍后重试' },
  'not-found': { retryable: false, message: '文件不存在或已被删除' },
  'invalid-request': { retryable: false, message: '请求参数不被金山文档接口接受' },
  'permission-denied': { retryable: false, message: '没有访问该文件的权限' },
  unsupported: { retryable: false, message: '该文件类型暂不支持此操作' },
  timeout: { retryable: true, message: '金山文档接口调用超时' },
  aborted: { retryable: false, message: '操作已取消' },
  'cli-not-installed': { retryable: false, message: '未找到 kdocs-cli，请先安装金山文档 CLI' },
  'cli-failed': { retryable: false, message: '金山文档 CLI 执行失败' },
  'malformed-response': { retryable: false, message: '金山文档 CLI 返回了无法解析的结果' },
  unknown: { retryable: false, message: '金山文档操作失败' },
});

/**
 * The one error type this seam throws.
 *
 * It carries the CLI's raw numeric code in `upstreamCode` for diagnostics and
 * logging, deliberately separated from the normalized `code` that consumers
 * branch on — so a consumer never has to know that `429001` exists, while a
 * support log still shows what the backend actually said.
 *
 * @extends Error
 */
export class KDocsError extends Error {
  /**
   * @param {KDocsErrorCode} code - normalized failure code.
   * @param {object} [options] - failure detail.
   * @param {string} [options.message] - override the code's default message.
   * @param {number} [options.retryAfterMs] - for `'rate-limited'`: how long to wait before retrying.
   * @param {number} [options.upstreamCode] - the CLI/backend numeric code, kept for diagnostics.
   * @param {string} [options.operation] - the operation that failed, e.g. `drive.read-file`.
   * @param {unknown} [options.cause] - the underlying error, when there was one.
   */
  constructor(code, options = {}) {
    const known = KDOCS_ERROR_CODES[code] ?? KDOCS_ERROR_CODES.unknown;
    const suffix = options.operation === undefined ? '' : ` (${options.operation})`;
    super(`${options.message ?? known.message}${suffix}`, { cause: options.cause });
    this.name = 'KDocsError';
    /** @type {KDocsErrorCode} */
    this.code = KDOCS_ERROR_CODES[code] === undefined ? 'unknown' : code;
    /** @type {boolean} */
    this.retryable = known.retryable;
    /** @type {number | undefined} */
    this.retryAfterMs = options.retryAfterMs;
    /** @type {number | undefined} */
    this.upstreamCode = options.upstreamCode;
    /** @type {string | undefined} */
    this.operation = options.operation;
  }

  /**
   * Whether a caught value is this seam's own error type.
   *
   * Consumers use this to decide between "a KDocs failure I can present" and
   * "a programming fault I should let crash".
   *
   * @param {unknown} value - caught value.
   * @returns {value is KDocsError} true when the value is a KDocsError.
   */
  static is(value) {
    return value instanceof KDocsError;
  }
}

/**
 * The normalized meaning of each numeric code the CLI is known to return.
 *
 * Anything absent from this table falls through to `'unknown'` rather than
 * being guessed at, so an unrecognized upstream failure stays visible as
 * unrecognized instead of being silently mislabeled.
 *
 * @type {Readonly<Record<number, KDocsErrorCode>>}
 */
export const UPSTREAM_CODE_MAP = Object.freeze({
  400006: 'not-authenticated',
  400100: 'invalid-request',
  400103: 'invalid-request',
  400104: 'not-found',
  403001: 'permission-denied',
  403002: 'permission-denied',
  404001: 'not-found',
  429001: 'rate-limited',
  429002: 'rate-limited',
  500001: 'cli-failed',
  500002: 'cli-failed',
});

/**
 * Classify one CLI/backend numeric code into this seam's vocabulary.
 *
 * @param {number | undefined} code - numeric code from the CLI envelope.
 * @returns {KDocsErrorCode} the normalized code.
 */
export function classifyUpstreamCode(code) {
  if (typeof code !== 'number') return 'unknown';
  return UPSTREAM_CODE_MAP[code] ?? 'unknown';
}

/**
 * How long a rate-limited caller should wait, from the CLI's own hint.
 *
 * The backend does not always state a delay, so this returns the documented
 * floor when it stays silent — the point is that a caller always has *some*
 * concrete wait rather than an invitation to retry immediately.
 *
 * @param {unknown} retryAfterSeconds - a `Retry-After` value in seconds, when present.
 * @returns {number} milliseconds to wait.
 */
export function retryDelayMs(retryAfterSeconds) {
  const floor = 5000;
  if (typeof retryAfterSeconds !== 'number' || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return floor;
  }
  return Math.max(floor, Math.round(retryAfterSeconds * 1000));
}
