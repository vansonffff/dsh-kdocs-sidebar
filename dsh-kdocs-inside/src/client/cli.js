/**
 * The only module in this package that executes `kdocs-cli`.
 *
 * Two rules make that concentration worth having:
 *
 * - **No shell, ever.** Every invocation goes through
 *   `spawn(binary, args, { shell: false })` with an argv *array*. User-supplied
 *   text (a search keyword, a file name) is serialized into one JSON argument
 *   and can never become a second command, a redirect, or a substitution.
 * - **The envelope, not the exit code, decides success.** `kdocs-cli` exits 0
 *   while reporting a business failure in its JSON body (`{"code":400100,...}`),
 *   so treating a zero exit as success would silently turn every API error into
 *   an empty result. Only a non-zero exit with no parsable body is a process
 *   failure.
 *
 * The CLI is also a black box that owns the user's credential: this module
 * never passes a token, never logs a token, and never reads the keychain.
 *
 * @module kdocs/client/cli
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { KDocsError, classifyUpstreamCode, retryDelayMs } from '../errors.js';
import { unwrapData } from './parse.js';

/**
 * The result of one CLI invocation, after envelope parsing.
 *
 * `data` is already unwrapped, so no consumer ever sees the CLI's variable
 * envelope depth.
 *
 * @typedef {object} CliOutcome
 * @property {boolean} ok - whether the call reported success (`code === 0`).
 * @property {unknown} [data] - the unwrapped payload.
 * @property {number} [code] - the backend's numeric code.
 * @property {string} [raw] - the trimmed stdout, for the few commands that print plain text.
 * @property {number} [exitCode] - the process exit code.
 */

/** Default ceiling for one CLI call. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Ceiling on captured stdout, enforced while the child is still writing.
 *
 * This is a memory bound, not a content policy: `maxContentBytes` decides how
 * much *body* travels upward, and it applies only after the whole stdout has
 * been buffered and parsed. A large spreadsheet extraction could therefore cost
 * the Host far more than the configured body budget before truncation ever ran.
 */
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024;

/** How much stderr to retain; only the tail is ever quoted in an error. */
const STDERR_KEEP_CHARS = 8_192;

/** How long `auth login` may wait for the browser round trip before it is abandoned. */
export const LOGIN_TIMEOUT_MS = 330_000;

/** How long `drive read-file` may spend extracting a large document. */
export const READ_TIMEOUT_MS = 180_000;

/**
 * The authorization URL `auth login` prints for the user to open.
 *
 * The CLI prints a banner to stdout rather than opening a browser itself, so
 * the caller is the one that decides how to present the URL.
 */
const AUTH_URL_PATTERN = /https?:\/\/[^\s"'<>]+/;

/**
 * Resolve the `kdocs-cli` executable.
 *
 * `KDOCS_CLI_DIR` wins so a non-standard installation is configuration rather
 * than a code change; otherwise the per-user install locations are probed, and
 * a bare name is the last resort so a `PATH` install still works. A bare name
 * is reported as `undefined` for `cliPath`, because "found on PATH" is not a
 * path this module can promise.
 *
 * @returns {{ command: string, path?: string }} the command to spawn, plus its absolute path when known.
 */
export function resolveCli() {
  const envDir = process.env.KDOCS_CLI_DIR;
  if (envDir !== undefined && envDir !== '') {
    const candidate = join(envDir, process.platform === 'win32' ? 'kdocs-cli.exe' : 'kdocs-cli');
    return { command: candidate, path: existsSync(candidate) ? candidate : undefined };
  }
  const candidates =
    process.platform === 'win32'
      ? [join(homedir(), 'AppData', 'Local', 'kdocs-cli', 'kdocs-cli.exe')]
      : [join(homedir(), '.local', 'bin', 'kdocs-cli')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { command: candidate, path: candidate };
  }
  return { command: 'kdocs-cli' };
}

/**
 * Extract the first JSON object from a CLI output stream.
 *
 * The CLI mixes prose banners with JSON (the auth flow prints instructions
 * before its payload), so scanning to the first brace is the documented shape
 * rather than a heuristic workaround.
 *
 * @param {string} text - captured stdout.
 * @returns {unknown} the parsed value, or undefined when there is none.
 */
export function parseEnvelope(text) {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return undefined;
  }
}

/**
 * Turn a completed CLI process into an outcome or a seam error.
 *
 * @param {object} input - captured process result.
 * @param {string} input.stdout - captured stdout.
 * @param {string} input.stderr - captured stderr.
 * @param {number | null} input.exitCode - process exit code.
 * @param {string} input.operation - operation label for diagnostics.
 * @returns {CliOutcome} the parsed outcome.
 * @throws {KDocsError} when the process failed or the backend reported a failure.
 */
export function interpretOutcome({ stdout, stderr, exitCode, operation }) {
  const parsed = parseEnvelope(stdout);
  const envelope = typeof parsed === 'object' && parsed !== null ? /** @type {Record<string, unknown>} */ (parsed) : undefined;

  if (envelope === undefined) {
    if (exitCode !== 0) {
      const detail = stderr.trim() || stdout.trim() || `exit ${String(exitCode)}`;
      throw new KDocsError('cli-failed', { operation, message: firstLine(detail) });
    }
    // A successful command with no JSON body: the plain-text commands, such as
    // `auth login`, report their outcome in prose.
    return { ok: true, raw: stdout.trim(), exitCode: exitCode ?? 0 };
  }

  const code = typeof envelope.code === 'number' ? envelope.code : undefined;
  const rawMessage = envelope.message ?? envelope.msg;
  const message = typeof rawMessage === 'string' && rawMessage !== '' ? rawMessage : undefined;

  if (code === undefined) {
    // No `code` field at all: a payload-only response. Treat it as data.
    return { ok: true, data: envelope, exitCode: exitCode ?? 0 };
  }

  if (code === 0) {
    // The payload may still be enveloped: metadata commands nest it one level
    // deeper than the extraction commands do.
    return { ok: true, data: unwrapData(envelope.data), code, exitCode: exitCode ?? 0 };
  }

  const normalized = classifyUpstreamCode(code);
  /** @type {Record<string, unknown> | undefined} */
  const details = typeof envelope.data === 'object' && envelope.data !== null
    ? /** @type {Record<string, unknown>} */ (envelope.data)
    : undefined;
  const nested = details !== undefined && typeof details.data === 'object' && details.data !== null
    ? /** @type {Record<string, unknown>} */ (details.data)
    : undefined;
  const retryAfterRaw = details?.retry_after ?? details?.retry_after_seconds ?? nested?.retry_after;
  const retryAfterMs = normalized === 'rate-limited' ? retryDelayMs(retryAfterRaw) : undefined;

  throw new KDocsError(normalized, {
    operation,
    message: message === undefined ? undefined : `金山文档返回 ${String(code)}：${message}`,
    upstreamCode: code,
    retryAfterMs,
  });
}

/**
 * Keep one diagnostic line, so a multi-line CLI banner cannot flood a log.
 *
 * @param {string} text - raw text.
 * @returns {string} its first non-empty line, truncated.
 */
function firstLine(text) {
  const line = text.split('\n').map((candidate) => candidate.trim()).find((candidate) => candidate !== '') ?? '';
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

/**
 * Run one `kdocs-cli` command.
 *
 * @param {string[]} argv - arguments after the binary, e.g. `['drive', 'list-my-files', '{}']`.
 * @param {object} [options] - invocation options.
 * @param {AbortSignal} [options.signal] - cancels the child process.
 * @param {number} [options.timeoutMs] - ceiling for the whole call.
 * @param {number} [options.maxStdoutBytes] - ceiling on captured stdout.
 * @param {string} [options.operation] - label used in errors and diagnostics.
 * @param {(chunk: string) => void} [options.onStdout] - observes stdout as it arrives, for the login banner.
 * @returns {Promise<CliOutcome>} the parsed outcome.
 * @throws {KDocsError} on cancellation, timeout, missing CLI, process failure, or a reported business failure.
 */
export function runCli(argv, options = {}) {
  const operation = options.operation ?? argv.slice(0, 2).join(' ');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const { command } = resolveCli();

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(new KDocsError('aborted', { operation }));
      return;
    }

    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = spawn(command, argv, {
        // The whole point of this module: an argv array with no shell, so no
        // argument can be reinterpreted as syntax.
        shell: false,
        // stdin stays closed: the CLI reads its JSON from argv, and the one
        // caller that needed a pipe (a pasted credential) is gone by design —
        // credentials belong to `kdocs-cli` and never travel through this plugin.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      reject(new KDocsError('cli-not-installed', { operation, cause: error }));
      return;
    }

    let stdout = '';
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    // Declared before the closures that reference it: `cleanup` and `onAbort`
    // are only *called* after assignment, but keeping the binding initialised
    // first removes the temporal-dead-zone trap entirely.
    /** @type {NodeJS.Timeout | undefined} */
    let timer;

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const kill = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* the process is already gone */
      }
    };

    function onAbort() {
      kill();
      fail(new KDocsError('aborted', { operation }));
    }

    timer = setTimeout(() => {
      kill();
      fail(new KDocsError('timeout', { operation, message: `kdocs-cli ${operation} 超时（${String(timeoutMs)}ms）` }));
    }, timeoutMs);

    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      // `maxContentBytes` bounds the *body handed upward*, not the memory this
      // process spends collecting it: stdout used to accumulate without limit and
      // was then parsed whole, so a large spreadsheet or KDC payload could grow
      // the Host long before any truncation applied. A ceiling here — enforced
      // while the child is still running — is the only bound that actually holds.
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > maxStdoutBytes) {
        kill();
        fail(new KDocsError('malformed-response', {
          operation,
          message: `kdocs-cli ${operation} 输出超过 ${String(Math.round(maxStdoutBytes / 1024))}KB 上限，已终止；请缩小读取范围（如表格选区）后重试`,
        }));
        return;
      }
      stdout += chunk;
      options.onStdout?.(String(chunk));
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      // Diagnostics are kept for the error message only, so the tail is what
      // matters and the rest can be dropped.
      if (stderr.length < STDERR_KEEP_CHARS * 2) stderr += chunk;
    });

    child.on('error', (error) => {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      fail(
        code === 'ENOENT'
          ? new KDocsError('cli-not-installed', {
              operation,
              message: `未找到 kdocs-cli（${command}）；请安装后重试，或设置 KDOCS_CLI_DIR 指向其所在目录`,
              cause: error,
            })
          : new KDocsError('cli-failed', { operation, message: firstLine(String(error.message)), cause: error }),
      );
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      try {
        succeed(interpretOutcome({ stdout, stderr, exitCode, operation }));
      } catch (error) {
        fail(error);
      }
    });
  });
}

/**
 * Run an API-style command whose parameters are a JSON object.
 *
 * Parameters are serialized into a single argv element, which is the CLI's
 * documented inline-JSON mode — no temporary files, no shell quoting, and no
 * way for a keyword to escape its argument.
 *
 * @param {string} service - CLI service, e.g. `drive`.
 * @param {string} action - CLI action, e.g. `search-files`.
 * @param {Record<string, unknown>} params - parameters, serialized as one JSON argument.
 * @param {object} [options] - invocation options, as {@link runCli}.
 * @returns {Promise<CliOutcome>} the parsed outcome.
 */
export function runAction(service, action, params = {}, options = {}) {
  const argv = [service, action, JSON.stringify(params), '--output', 'json'];
  return runCli(argv, { ...options, operation: options.operation ?? `${service}.${action}` });
}

/**
 * Read the CLI's own version string.
 *
 * @param {object} [options] - invocation options.
 * @returns {Promise<string | undefined>} the version, or undefined when it could not be read.
 */
export async function cliVersion(options = {}) {
  try {
    const outcome = await runCli(['--version'], { ...options, timeoutMs: 15_000, operation: 'version' });
    const first = (outcome.raw ?? '').split('\n')[0]?.trim();
    return first === undefined || first === '' ? undefined : first;
  } catch {
    // Version is orientation, never a reason to fail a status check.
    return undefined;
  }
}

/**
 * Whether a text chunk contains the login authorization URL.
 *
 * @param {string} chunk - a stdout chunk.
 * @returns {string | undefined} the URL, when this chunk carries one.
 */
export function authUrlIn(chunk) {
  const match = AUTH_URL_PATTERN.exec(chunk);
  return match === null ? undefined : match[0];
}
