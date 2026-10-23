import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { KDocsPreviewCache, downloadPreview, previewName, checkPreviewUrl } from '../src/client/preview-cache.js';
import { KDocsCliProvider } from '../src/client/provider.js';

const PDF = Buffer.from('%PDF-1.4\npublic test\n%%EOF');
const ref = { driveId: 'drive', fileId: 'file' };
const url = 'https://download.wps365.com/public.pdf?signature=secret-test';
const loader = async (path, signal) => { signal.throwIfAborted(); await writeFile(path, PDF, { mode: 0o600 }); return { size: PDF.length, source: 'download' }; };

it('安全名称兼容路径穿越、Windows 设备名与超长名称', () => {
  for (const name of ['../合同.pdf', 'CON.pdf', 'NUL.docx', 'a<>:"/\\|?*\0.pdf', 'a'.repeat(300) + '.pdf']) {
    const safe = previewName(name); assert.ok(!/[<>:"/\\|?*\x00-\x1f]/.test(safe)); assert.ok(safe.length < 90); assert.ok(safe.endsWith('.pdf'));
  }
  assert.equal(previewName('CON.pdf'), '_CON.pdf');
});

it('只接受金山 HTTPS 地址，拒绝私网、伪后缀、凭据和异常端口', () => {
  assert.equal(checkPreviewUrl(url).protocol, 'https:');
  for (const raw of ['http://download.wps365.com/x', 'https://127.0.0.1/x', 'https://wps.cn.evil.test/x', 'https://user:pass@wps.cn/x', 'https://wps.cn:1234/x']) assert.throws(() => checkPreviewUrl(raw));
});

it('有界下载验证 PDF 和官方 hashes[].sum，不返回签名地址', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kdocs-test-'));
  try {
    const size = await downloadPreview(url, join(base, 'ok'), { hashes: [{ type: 'sha256', sum: createHash('sha256').update(PDF).digest('hex') }], fetcher: async () => new Response(PDF) });
    assert.equal(size, PDF.length);
    await assert.rejects(downloadPreview(url, join(base, 'bad-hash'), { hashes: [{ type: 'sha256', sum: '0'.repeat(64) }], fetcher: async () => new Response(PDF) }), /哈希/);
    await assert.rejects(downloadPreview(url, join(base, 'html'), { fetcher: async () => new Response('<html>') }), /不是 PDF/);
    await assert.rejects(downloadPreview(url, join(base, 'large'), { maxBytes: 5, fetcher: async () => new Response(PDF) }), /上限/);
    await assert.rejects(downloadPreview(url, join(base, 'forbidden'), { fetcher: async () => new Response('', { status: 403 }) }), /下载权限/);
    await assert.rejects(downloadPreview(url, join(base, 'redirect'), { fetcher: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }) }), /地址/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

it('并发同文件仅下载一次；缓存命中、刷新身份、同名不同文件与私有权限', async () => {
  const cache = new KDocsPreviewCache(); let calls = 0;
  const load = async (...args) => { calls++; return loader(...args); };
  try {
    const [a, b] = await Promise.all([cache.prepare('one', '合同.pdf', load), cache.prepare('one', '合同.pdf', load)]);
    assert.equal(calls, 1); assert.equal(a.absolutePath, b.absolutePath);
    assert.equal((await cache.prepare('one', '合同.pdf', load)).cached, true); assert.equal(calls, 1);
    const refreshed = await cache.prepare('one', '新名称.pdf', load, { refresh: true }); assert.equal(refreshed.absolutePath, a.absolutePath); assert.equal(calls, 2);
    const other = await cache.prepare('two', '合同.pdf', load); assert.notEqual(other.absolutePath, a.absolutePath);
    assert.deepEqual(await readFile(a.absolutePath), PDF);
    if (process.platform !== 'win32') { assert.equal((await stat(await cache.init())).mode & 0o777, 0o700); assert.equal((await stat(a.absolutePath)).mode & 0o777, 0o600); }
  } finally { await cache.dispose(); }
});

it('容量满时保留已有官方 Tab 文件，停止插件时清理本实例', async () => {
  const cache = new KDocsPreviewCache({ maxEntries: 1, maxBytes: PDF.length });
  const first = await cache.prepare('one', 'one.pdf', loader);
  await assert.rejects(cache.prepare('two', 'two.pdf', loader), /缓存已满/);
  assert.deepEqual(await readFile(first.absolutePath), PDF);
  const root = await cache.init(); await cache.dispose(); await assert.rejects(stat(root), { code: 'ENOENT' });
});

it('下载取消清理半成品；一位等待者取消不影响其他等待者', async () => {
  const cache = new KDocsPreviewCache(); const abort = new AbortController();
  try {
    let resume;
    const gate = new Promise(r => { resume = r; });
    const load = async (path, signal) => { await gate; return loader(path, signal); };
    const first = cache.prepare('one', 'one.pdf', load, { signal: abort.signal });
    const rejected = assert.rejects(first, /取消/);
    const second = cache.prepare('one', 'one.pdf', load); abort.abort(); resume(); await rejected;
    assert.ok((await second).absolutePath);
    await assert.rejects(cache.prepare('bad', 'bad.pdf', async path => { await writeFile(path, 'partial'); throw new Error('cancelled'); }));
    const dirs = await readdir(await cache.init(), { withFileTypes: true });
    for (const dir of dirs.filter(d => d.isDirectory())) assert.ok(!(await readdir(join(await cache.init(), dir.name))).some(name => name.endsWith('.partial')));
  } finally { await cache.dispose(); }
});

it('Provider 原生 PDF 下载与 Office 导出分流，拒绝 pof 和表格', async () => {
  const savedFetch = globalThis.fetch; globalThis.fetch = async () => new Response(PDF);
  try {
    for (const extension of ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'pof', 'xlsx']) {
      const provider = new KDocsCliProvider({}, { exportPollIntervalMs: 1 }); const calls = [];
      provider.stat = async () => ({ name: 'public.' + extension });
      provider.runAction = async (service, action, params) => {
        calls.push([service, action, params]);
        if (action === 'download-file') return { data: { url } };
        if (action === 'export') return { data: { task_id: 'task' } };
        return { data: { status: 'finished', data: { url } } };
      };
      try {
        if (['pof', 'xlsx'].includes(extension)) { await assert.rejects(provider.preparePreview(ref), /不支持/); assert.equal(calls.length, 0); continue; }
        const file = await provider.preparePreview(ref);
        assert.equal(file.source, extension === 'pdf' ? 'download' : 'export');
        assert.equal(calls[0][1], extension === 'pdf' ? 'download-file' : 'export');
        if (extension === 'pdf') { assert.equal(calls.length, 1); assert.equal(calls[0][2].storage_base_domain, 'wps365.com'); }
        assert.ok(!JSON.stringify(file).includes('signature')); assert.ok(!JSON.stringify(file).includes('base64'));
      } finally { await provider.previewCache.dispose(); }
    }
  } finally { globalThis.fetch = savedFetch; }
});

it('超限响应立即取消；中断下载和无效可靠哈希不留下文件', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kdocs-test-'));
  try {
    let cancelled = false;
    await assert.rejects(downloadPreview(url, join(base, 'oversize'), {
      fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': String(31 * 1024 * 1024) } }),
    }), /上限/);
    assert.equal(cancelled, true);
    const controller = new AbortController();
    await assert.rejects(downloadPreview(url, join(base, 'aborted'), {
      signal: controller.signal,
      fetcher: async () => new Response(new ReadableStream({ start(c) { c.enqueue(PDF); controller.abort(); } })),
    }), /取消/);
    await assert.rejects(downloadPreview(url, join(base, 'missing-hash'), { hashes: [{ type: 'sha256' }], fetcher: async () => new Response(PDF) }), /哈希/);
    assert.deepEqual(await readdir(base), []);
  } finally { await rm(base, { recursive: true, force: true }); }
});

it('总容量检查不损坏已缓存文件，失败的新目录自动释放', async () => {
  const cache = new KDocsPreviewCache({ maxBytes: PDF.length });
  try {
    const first = await cache.prepare('first', 'one.pdf', loader);
    await assert.rejects(cache.prepare('second', 'two.pdf', loader), /总容量/);
    assert.deepEqual(await readFile(first.absolutePath), PDF);
    assert.equal((await readdir(await cache.init(), { withFileTypes: true })).filter(v => v.isDirectory()).length, 1);
  } finally { await cache.dispose(); }
});

it('启动清理只移除超过一天且进程退出的缓存，保留当前活跃实例', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kdocs-test-'));
  const cache = new KDocsPreviewCache({ base });
  try {
    for (const [name, pid] of [['stale', 2147483647], ['active', process.pid]]) {
      const dir = join(base, 'dsh-kdocs-preview-' + name);
      await (await import('node:fs/promises')).mkdir(dir, { mode: 0o700 });
      await writeFile(join(dir, 'owner.json'), JSON.stringify({ pid, created: Date.now() - 2 * 86400000 }));
    }
    await cache.cleanup();
    assert.deepEqual(await readdir(base), ['dsh-kdocs-preview-active']);
  } finally { await cache.dispose(); await rm(base, { recursive: true, force: true }); }
});
