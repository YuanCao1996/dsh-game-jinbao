import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 设置页靠一张「h2 文字 → 页面分组」的映射表决定每个 section 归哪页；
// 映射不到就被标成 undefined + active=false，被 CSS 隐藏。0.2.43 的「测试功能」就是这样消失的。
test('设置页每个 section 的标题都能映射到某个页面分组', async () => {
  const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
  const mapSource = /const groups=\{([^}]*)\}/.exec(html)?.[1];
  assert.ok(mapSource, '找不到 groups 映射表');
  const mapped = new Set([...mapSource.matchAll(/'([^']+)'\s*:\s*'[^']+'/g)].map(m => m[1]));

  // 特殊处理：靠 id 或标签类型分组的节点
  const special = new Set(['accountCard', 'genericPanel', 'activitySettings', 'updateNotice']);
  const sections = [...html.matchAll(/<section\b([^>]*)>\s*<h2>([^<]+)<\/h2>/g)];
  assert.ok(sections.length > 5, 'section 数量异常：' + sections.length);
  const missing = [];
  for (const [, attrs, title] of sections) {
    const id = /id="([^"]+)"/.exec(attrs)?.[1];
    if (id && special.has(id)) continue;
    if (/data-settings-group="/.test(attrs)) continue;
    if (!mapped.has(title.trim())) missing.push(title.trim());
  }
  assert.deepEqual(missing, [], '这些标题没进映射表，会被隐藏：' + missing.join('、'));
});
