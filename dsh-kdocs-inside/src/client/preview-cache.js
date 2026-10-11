import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KDocsError } from '../errors.js';

const exec = promisify(execFile);
const PREFIX = 'dsh-kdocs-preview-';
const DAY = 24 * 60 * 60 * 1000;
const fail = (message) => new KDocsError('unsupported', { operation: 'preview-cache', message });

/** 云端名称只用于显示安全的文件名，目录身份由随机标识生成。 */
export function previewName(name) {
  let stem = String(name).replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80);
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + (stem || 'preview');
  return stem + '.pdf';
}

/** 下载地址只能在 Host 内使用；每次重定向都重新校验。 */
export function checkPreviewUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw fail('PDF 预览失败：下载地址无效。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || !/(^|\.)(wps\.cn|wps365\.com|kdocs\.cn|wpscdn\.cn|wpscdn\.com|kingsoft\.com)$/i.test(url.hostname)) {
    throw fail('PDF 预览失败：下载地址不属于支持的金山 HTTPS 存储域名。');
  }
  return url;
}

/** 有界流式下载，不把签名地址或底层 fetch 异常发给前端。 */
export async function downloadPreview(raw, target, { signal, maxBytes = 30 * 1024 * 1024, hashes = [], fetcher = fetch } = {}) {
  let handle;
  let reader;
  let response;
  let complete = false;
  try {
    let url = checkPreviewUrl(raw);
    for (let i = 0; i <= 3; i++) {
      response = await fetcher(url, { redirect: 'manual', signal, credentials: 'omit' });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      if (i === 3) throw fail('PDF 预览失败：下载重定向次数过多。');
      url = checkPreviewUrl(new URL(response.headers.get('location') ?? '', url).href);
    }
    if (response.status === 403) throw new KDocsError('permission-denied', { message: '无法取得该文件的预览副本，请检查金山文档下载权限。' });
    if (!response.ok || !response.body) throw fail('PDF 预览失败：无法下载该文件。');
    const announced = Number(response.headers.get('content-length'));
    if (announced > maxBytes) throw fail('PDF 超过单文件预览上限。');
    handle = await open(target, 'wx', 0o600);
    reader = response.body.getReader();
    const algorithms = new Map(['md5', 'sha1', 'sha256'].map(a => [a, createHash(a)]));
    let size = 0;
    let head = Buffer.alloc(0);
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw fail('PDF 超过单文件预览上限。');
      if (head.length < 5) head = Buffer.concat([head, Buffer.from(value).subarray(0, 5 - head.length)]);
      if (head.length === 5 && head.toString('latin1') !== '%PDF-') throw fail('下载回来的内容不是 PDF，无法预览。');
      for (const hash of algorithms.values()) hash.update(value);
      await handle.writeFile(value);
    }
    if (head.toString('latin1') !== '%PDF-') throw fail('下载回来的内容不是 PDF，无法预览。');
    if (announced > 0 && size !== announced) throw fail('PDF 下载不完整。');
    const digests = Object.fromEntries([...algorithms].map(([a, h]) => [a, h.digest('hex')]));
    for (const item of hashes ?? []) {
      const algorithm = String(item.type ?? item.algorithm ?? item.name ?? '').toLowerCase().replace(/-/g, '');
      const value = item.sum ?? item.value ?? item.hash ?? item.digest;
      if (digests[algorithm] && (typeof value !== 'string' || digests[algorithm] !== value.toLowerCase())) throw fail('PDF 哈希校验不一致，无法预览。');
    }
    await handle.sync();
    complete = true;
    return size;
  } catch (error) {
    if (error instanceof KDocsError) throw error;
    if (signal?.aborted) throw new KDocsError(signal.reason?.name === 'TimeoutError' ? 'timeout' : 'aborted', { message: signal.reason?.name === 'TimeoutError' ? 'PDF 下载超时。' : '预览准备已取消。' });
    throw fail('PDF 预览失败：无法下载该文件。');
  } finally {
    await reader?.cancel().catch(() => {});
    if (!reader) await response?.body?.cancel().catch(() => {});
    await handle?.close();
    if (!complete && handle) await rm(target, { force: true });
  }
}

/** 无可靠跨插件关闭通知：返回过的文件保留至实例停止，容量不足明确拒绝，避免删除仍打开的文件。 */
export class KDocsPreviewCache {
  constructor({ base = tmpdir(), maxBytes = 120 * 1024 * 1024, maxEntries = 20, ttlMs = 60 * 60 * 1000 } = {}) {
    this.base = base; this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.ttlMs = ttlMs;
    this.entries = new Map(); this.pending = new Map(); this.controller = new AbortController(); this.queue = Promise.resolve();
  }
  async init() {
    if (!this.rootPromise) this.rootPromise = (async () => {
      await this.cleanup();
      const root = await mkdtemp(join(this.base, PREFIX));
      try {
        if (process.platform === 'win32') {
          const { stdout } = await exec('whoami', ['/user', '/fo', 'csv', '/nh']);
          const sid = /S-1-5-[0-9-]+/.exec(stdout)?.[0];
          if (!sid) throw fail('无法核验当前用户的缓存访问权限。');
          await exec('icacls', [root, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`]);
          const acl = await exec('icacls', [root]);
          if (!acl.stdout.includes(sid) && !acl.stdout.includes(process.env.USERNAME ?? '\0')) throw fail('无法核验缓存访问权限。');
        }
        await (await import('node:fs/promises')).chmod(root, 0o700);
        await (await import('node:fs/promises')).writeFile(join(root, 'owner.json'), JSON.stringify({ pid: process.pid, created: Date.now() }), { mode: 0o600 });
        return root;
      } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
    })();
    return this.rootPromise;
  }
  async prepare(key, name, loader, { refresh = false, signal } = {}) {
    this.controller.signal.throwIfAborted(); signal?.throwIfAborted();
    // 每个等待者都拥有自己的取消；最后一个取消时才取消共享下载。
    let job = this.pending.get(key);
    if (!job) {
      const controller = new AbortController();
      job = { controller, waiters: 0 };
      const run = this.queue.then(async () => {
        const combined = AbortSignal.any([controller.signal, this.controller.signal]); combined.throwIfAborted();
        const root = await this.init();
        let entry = this.entries.get(key);
        if (entry && !refresh && Date.now() - entry.at < this.ttlMs) return { ...entry.result, cached: true };
        if (!entry && this.entries.size >= this.maxEntries) throw fail('预览缓存已满，请重启插件后重试。');
        const dir = entry?.dir ?? join(root, randomUUID());
        await mkdir(dir, { mode: 0o700, recursive: true });
        const path = entry?.result.absolutePath ?? join(dir, previewName(name));
        const temp = join(dir, randomUUID() + '.partial');
        try {
          const loaded = await loader(temp, combined);
          combined.throwIfAborted();
          const total = [...this.entries.values()].reduce((n, e) => n + e.result.size, 0) - (entry?.result.size ?? 0) + loaded.size;
          if (total > this.maxBytes) throw fail('预览缓存超过总容量上限，请重启插件后重试。');
          await rename(temp, path);
          const result = { kind: 'pdf-file', absolutePath: path, name: basename(path), size: loaded.size, source: loaded.source, cached: false };
          this.entries.delete(key); this.entries.set(key, { dir, result, at: Date.now() });
          return result;
        } finally { await rm(temp, { force: true }); if (!this.entries.has(key)) await rm(dir, { recursive: true, force: true }); }
      });
      job.promise = run.finally(() => { if (this.pending.get(key) === job) this.pending.delete(key); });
      this.pending.set(key, job); this.queue = job.promise.catch(() => {});
    }
    job.waiters++;
    return new Promise((accept, reject) => {
      let done = false;
      const finish = (fn, value) => { if (done) return; done = true; signal?.removeEventListener('abort', abort); job.waiters--; if (!job.waiters) job.controller.abort(); fn(value); };
      const abort = () => finish(reject, new KDocsError('aborted', { message: '预览准备已取消。' }));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      job.promise.then(v => finish(accept, v), e => finish(reject, e));
    });
  }
  invalidate() { for (const entry of this.entries.values()) entry.at = 0; }
  async cleanup() {
    // 只回收有自身标记、过期且原进程已退出的实例，拒绝跟随符号链接。
    for (const item of await readdir(this.base, { withFileTypes: true })) {
      if (!item.isDirectory() || !item.name.startsWith(PREFIX)) continue;
      const path = resolve(this.base, item.name);
      try {
        const info = await lstat(path);
        if (process.getuid && info.uid !== process.getuid()) continue;
        const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !Number.isFinite(owner.created) || Date.now() - owner.created < DAY) continue;
        try { process.kill(owner.pid, 0); continue; } catch (error) { if (error.code !== 'ESRCH') continue; }
        await rm(path, { recursive: true, force: true });
      } catch { /* 不能确认归属时保留。 */ }
    }
  }
  async dispose() {
    this.controller.abort(); await this.queue;
    if (this.rootPromise) { const root = await this.rootPromise.catch(() => undefined); if (root) await rm(root, { recursive: true, force: true }); }
    this.entries.clear();
  }
}
