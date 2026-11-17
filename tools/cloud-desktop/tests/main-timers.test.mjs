import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 这个坑踩过：一次批量编辑把 `const speechTimer=setInterval(...)` 整行吞掉了，
// 表现是语音队列不再推进、退出时 quiesce 抛 ReferenceError、更新装完不重启。
// 静态检查每个定时器都被清掉，成本极低。
test('main.mjs 里每个 setInterval 都要在 quiesce 里 clearInterval', async () => {
  const source = await readFile(new URL('../main.mjs', import.meta.url), 'utf8');
  const names = [...source.matchAll(/const (\w+)\s*=\s*setInterval\(/g)].map(match => match[1]);
  assert.ok(names.length >= 6, '定时器数量异常：' + names.join(','));
  for (const name of names) {
    assert.ok(source.includes(`clearInterval(${name})`), `定时器 ${name} 没有被 clearInterval`);
  }
  // 语音时钟必须在（0.2.36 就是丢了它）
  assert.ok(names.includes('speechTimer'), '缺少语音时钟 speechTimer');
});
