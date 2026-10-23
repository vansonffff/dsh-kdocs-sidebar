import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 宿主包只能作为可选 peer；普通依赖会在成员安装时引入第二套核心包。
function check(manifest) {
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    assert.ok(!name.startsWith('@deepseek-ai/dsh-') && name !== '@deepseek-ai/cordis', `宿主包不可放入 dependencies: ${name}`);
  }
  for (const [name, version] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh-') && name !== '@deepseek-ai/cordis') continue;
    assert.equal(version, name === '@deepseek-ai/cordis' ? '~4.0.4' : '>=0.2.0-rc.2 || 0.2.1-rc.2');
    assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true);
  }
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-typert-protocol'], '>=0.2.0-rc.2 || 0.2.1-rc.2');
}
test('发布声明使用宿主提供的同版本核心包', () => {
  check(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
});
test('负向对照：拒绝旧核心普通依赖和非可选 peer', () => {
  assert.throws(() => check({ dependencies: { '@deepseek-ai/dsh-tools': '^0.1.7-rc.1' } }));
  assert.throws(() => check({ peerDependencies: { '@deepseek-ai/dsh-typert-protocol': '0.2.0-rc.2' } }));
});
