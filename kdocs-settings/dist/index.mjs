// kdocs-settings host plugin — bridges the settings UI (via credentials refs)
// to the kdocs-cli binary installed on the host machine.
//
// Credential refs (all host-writable, none shadowed by process env):
//   KDOCS_TOKEN        — user-provided WPS token (client sets, host persists via kdocs-cli)
//   KDOCS_AUTH_LOGIN   — client sets this ref to trigger `kdocs-cli auth login`
//   KDOCS_AUTH_STATUS  — host writes JSON status; configured => authenticated
//
// DSH 0.1.5 contract notes (both were silent breakages on 0.1.4-era code):
//   * the credential-change event is `credentials/reference-updated(ref)`;
//     `credentials/updated` is not emitted by any package in 0.1.5-rc.1, so a
//     listener on that name simply never ran.
//   * `auth set-token` reads from stdin (`-`); the token must never travel in
//     argv, which every local process can read with `ps`.

import { spawn, execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const REF_TOKEN = 'KDOCS_TOKEN';
const REF_LOGIN = 'KDOCS_AUTH_LOGIN';
const REF_STATUS = 'KDOCS_AUTH_STATUS';

const LOGIN_TIMEOUT_MS = 330000; // kdocs-cli waits up to 5 minutes for the browser flow

/** Resolve the kdocs-cli binary path. */
function cliPath() {
  const envDir = process.env.KDOCS_CLI_DIR;
  if (envDir) return join(envDir, 'kdocs-cli');
  const candidates = [
    join(homedir(), '.local', 'bin', 'kdocs-cli'),
    join(homedir(), 'AppData', 'Local', 'kdocs-cli', 'kdocs-cli.exe'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'kdocs-cli'; // fall back to PATH
}

/**
 * Run kdocs-cli once and collect stdout/stderr.
 * @param args - argv after the binary name.
 * @param options.timeoutMs - kill the child after this long.
 * @param options.stdin - text to write to the child's stdin; omit to leave it closed.
 */
function runCli(args, { timeoutMs = 60000, stdin } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let settled = false;
    let child;
    try {
      child = spawn(cliPath(), args, { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: -1, out: '', err: String(error?.message ?? error) });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ code: -1, out, err: `kdocs-cli ${args.join(' ')} timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { out += chunk; });
    child.stderr?.on('data', (chunk) => { err += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(error?.message ?? error) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    if (stdin !== undefined && child.stdin) {
      // The CLI may exit before draining stdin; that must not become an
      // unhandled 'error' event on the pipe.
      child.stdin.on('error', () => { /* ignore */ });
      child.stdin.end(stdin);
    }
  });
}

/** Open a URL in the user's default browser on the host desktop. */
function openExternal(url) {
  const platform = process.platform;
  if (platform === 'darwin') return execFile('open', [url]);
  if (platform === 'win32') return execFile('cmd', ['/c', 'start', '', url]);
  return execFile('xdg-open', [url]);
}

/** Parse the auth URL from `kdocs-cli auth login` output. */
function extractLoginUrl(out) {
  const match = /https?:\/\/[^\s"'<>]+/.exec(out);
  return match ? match[0] : null;
}

export function apply(ctx, _config) {
  /** Refresh KDOCS_AUTH_STATUS from `kdocs-cli auth status`. */
  async function refreshStatus() {
    let payload;
    try {
      const result = await runCli(['auth', 'status'], { timeoutMs: 30000 });
      if (result.code === 0) {
        const start = result.out.indexOf('{');
        const parsed = start >= 0 ? JSON.parse(result.out.slice(start)) : {};
        payload = {
          authenticated: parsed.authenticated === true,
          keychain: parsed.keychain
            ? {
                available: parsed.keychain.available === true,
                backend: parsed.keychain.backend ?? null,
                consistent: parsed.keychain.consistent === true,
              }
            : null,
          checkedAt: Date.now(),
        };
      } else {
        payload = {
          authenticated: false,
          error: (result.err || result.out).trim() || `kdocs-cli exit ${result.code}`,
          checkedAt: Date.now(),
        };
      }
    } catch (error) {
      payload = {
        authenticated: false,
        error: String(error?.message ?? error),
        checkedAt: Date.now(),
      };
    }
    if (payload.authenticated) {
      await ctx.credentials.set(REF_STATUS, JSON.stringify(payload)).catch(() => {});
    } else {
      await ctx.credentials.unset(REF_STATUS).catch(() => {});
    }
    return payload;
  }

  /** Persist a user-supplied token: the value goes over stdin, never argv. */
  async function persistToken(value) {
    const result = await runCli(['auth', 'set-token', '-'], { stdin: value, timeoutMs: 30000 });
    if (result.code === 0) {
      ctx.logger.info('kdocs token stored in the system keychain');
    } else {
      ctx.logger.warn(`kdocs auth set-token failed (exit ${result.code}): ${(result.err || result.out).trim()}`);
    }
    return result;
  }

  /**
   * Start `kdocs-cli auth login`; open the browser at the printed URL.
   * @returns a promise settling once the CLI exited, the trigger ref is
   *   released, and the status ref is republished.
   */
  function handleLogin() {
    return new Promise((resolve) => {
      const child = spawn(cliPath(), ['auth', 'login'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      let urlOpened = false;
      let settled = false;
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        setTimeout(() => { void finish(`kdocs auth login timed out after ${LOGIN_TIMEOUT_MS}ms`); }, 2000);
      }, LOGIN_TIMEOUT_MS);
      /** Release the trigger ref and republish status; runs once per login. */
      const finish = async (note) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Clearing the trigger ref cannot re-enter handleLogin: the listener
        // only starts a login for a ref that resolves to a value.
        await ctx.credentials.unset(REF_LOGIN).catch(() => {});
        await refreshStatus();
        ctx.logger.info(note);
        resolve();
      };
      child.stdout?.on('data', (chunk) => {
        out += chunk;
        if (!urlOpened) {
          const url = extractLoginUrl(out);
          if (url) {
            urlOpened = true;
            try { openExternal(url); } catch { /* browser open is best-effort */ }
          }
        }
      });
      child.stderr?.on('data', (chunk) => { err += chunk; });
      child.on('error', (error) => {
        void finish(`kdocs auth login failed: ${error?.message ?? error}`);
      });
      child.on('close', (code) => {
        const detail = (err || out).trim();
        void finish(`kdocs auth login finished (exit ${code})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      });
    });
  }

  let loginInFlight = false;

  ctx.on('credentials/reference-updated', async (payload) => {
    const ref = typeof payload === 'string' ? payload : payload?.ref;
    if (ref === REF_TOKEN) {
      const hit = await ctx.credentials.resolve(REF_TOKEN);
      if (hit?.value) {
        await persistToken(hit.value);
        await refreshStatus();
      } else {
        await runCli(['auth', 'logout'], { timeoutMs: 30000 });
        await ctx.credentials.unset(REF_STATUS).catch(() => {});
      }
    } else if (ref === REF_LOGIN) {
      // Presence means "start a login": the ref is set by the settings panel
      // and cleared here once the CLI exits, so only a set value may trigger.
      const hit = await ctx.credentials.resolve(REF_LOGIN);
      if (!hit?.value || loginInFlight) return;
      loginInFlight = true;
      try {
        await handleLogin();
      } finally {
        loginInFlight = false;
      }
    }
  });

  // Initial status refresh once the composition has settled.
  setTimeout(() => { void refreshStatus(); }, 3000);
}
