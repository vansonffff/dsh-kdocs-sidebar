import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KDocsCliProvider } from '../src/client/provider.js';
import { fieldSchema } from '../src/remote-schemas.js';
import { z } from 'zod';

test('four server-side sort choices reach root, folder and subsequent-page CLI requests', async () => {
  const provider = new KDocsCliProvider(undefined, { pageSize: 50 });
  const calls = [];
  provider.runAction = async (service, action, params) => {
    calls.push({ service, action, params });
    return { data: { items: [], next_page_token: 'NEXT' } };
  };
  for (const orderBy of ['fname', 'mtime']) for (const order of ['asc', 'desc']) {
    const sort = { orderBy, order };
    const page = await provider.list(undefined, undefined, undefined, sort);
    assert.equal(page.nextCursor, 'NEXT');
    await provider.list({ driveId: 'D', fileId: 'F' }, page.nextCursor, undefined, sort);
    const [root, folder] = calls.slice(-2);
    assert.deepEqual(root, { service: 'drive', action: 'list-my-files', params: { page_size: 50, order_by: orderBy, order } });
    assert.deepEqual(folder.params, { page_size: 50, order_by: orderBy, order, page_token: 'NEXT', parent_id: 'F', drive_id: 'D' });
  }
  await provider.list();
  assert.deepEqual(calls.at(-1).params, { page_size: 50 });
});

test('unknown sort fields/directions are rejected at both wire and provider boundary', async () => {
  const schema = fieldSchema({ kind: 'sortOptions' }, z);
  const provider = new KDocsCliProvider();
  provider.runAction = async () => { throw new Error('invalid sort must not reach CLI'); };
  for (const options of [{ orderBy: 'size', order: 'asc' }, { orderBy: 'fname', order: 'up' }, null]) {
    assert.equal(schema.safeParse(options).success, false);
    await assert.rejects(provider.list(undefined, undefined, undefined, options), /无效的排序选项/);
  }
  assert.equal(schema.safeParse({ orderBy: 'mtime', order: 'desc' }).success, true);
});

test('view sorting only sends fields supported by that CLI action', async () => {
  const provider = new KDocsCliProvider();
  const calls = [];
  provider.runAction = async (_service, action, params) => { calls.push({ action, params }); return { data: { items: [] } }; };
  for (const view of ['sharedWithMe', 'sharedByMe']) {
    await provider.listView(view, 'NEXT', undefined, { orderBy: 'mtime', order: 'asc' });
    assert.equal(calls.at(-1).params.order_by, 'mtime');
    assert.equal(calls.at(-1).params.order, 'asc');
    assert.equal(calls.at(-1).params.page_token, 'NEXT');
    await assert.rejects(provider.listView(view, undefined, undefined, { orderBy: 'fname', order: 'asc' }), /不支持/);
  }
  for (const view of ['team', 'starred', 'recent', 'trash']) {
    await assert.rejects(provider.listView(view, undefined, undefined, { orderBy: 'mtime', order: 'asc' }), /不支持/);
  }
});
