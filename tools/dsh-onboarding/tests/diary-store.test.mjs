import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiaryStore } from '../diary-store.mjs';

test('日记存储：默认开启、按天读写、可删单篇也可清空', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-diary-store-'));
  try {
    const store = createDiaryStore({ stateDir: dir });
    assert.deepEqual(await store.settings(), { enabled: true }, '默认开启');
    assert.deepEqual(await store.setSettings({ enabled: false }), { enabled: false });
    assert.deepEqual(await store.settings(), { enabled: false });
    await store.setSettings({ enabled: true });

    const saved = await store.save({ day: '2026-11-15', at: 100, title: '改口三次', body: '第一段。\n\n第二段。', mood: '心虚', line: '明天再讲吧', role: '金宝', topic: 'chat', score: 7 });
    assert.equal(saved.chars, 8);
    assert.deepEqual(saved.paragraphs, ['第一段。', '第二段。']);
    const entry = await store.get('2026-11-15');
    assert.equal(entry.title, '改口三次');
    assert.deepEqual(entry.paragraphs, ['第一段。', '第二段。']);

    await store.save({ day: '2026-11-14', title: '第二天', body: '嗯。', mood: '平静' });
    const list = await store.list();
    assert.deepEqual(list.map(row => row.day), ['2026-11-15', '2026-11-14'], '新的在前');
    assert.equal(list[0].hasLine, true);
    assert.equal(await store.count(), 2);

    await store.remove('2026-11-14');
    assert.equal(await store.get('2026-11-14'), null);
    assert.equal(await store.count(), 1);
    assert.equal(await store.removeAll(), 1);
    assert.equal(await store.count(), 0);
    assert.equal(await store.get('bad-day'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('不合规的内容拒绝写入：非法日期、空正文、超长', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-diary-validate-'));
  try {
    const store = createDiaryStore({ stateDir: dir });
    await assert.rejects(() => store.save({ day: '2026/11/15', body: '正文' }), /Invalid diary day/);
    await assert.rejects(() => store.save({ day: '2026-11-15', body: '   ' }), /Empty diary body/);
    await assert.rejects(() => store.save({ day: '2026-11-15', body: '字'.repeat(700) }), /too long/);
    const unknownMood = await store.save({ day: '2026-11-15', body: '还行。', mood: '开心' });
    assert.equal(unknownMood.mood, '平静');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('「她惦记的那句话」只会用一次，一周最多两次', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-diary-line-'));
  try {
    const store = createDiaryStore({ stateDir: dir });
    await store.save({ day: '2026-11-13', title: '一', body: '一。', line: '想过问他要不要先出鞋' });
    await store.save({ day: '2026-11-14', title: '二', body: '二。', line: '想问问他为什么不出水银' });
    const first = await store.pendingLine({ today: '2026-11-15' });
    assert.deepEqual(first, { day: '2026-11-14', text: '想问问他为什么不出水银' }, '先取最近的一篇');
    await store.markLineUsed('2026-11-14');
    const second = await store.pendingLine({ today: '2026-11-15' });
    assert.deepEqual(second, { day: '2026-11-13', text: '想过问他要不要先出鞋' });
    await store.markLineUsed('2026-11-13');
    assert.equal(await store.pendingLine({ today: '2026-11-15' }), null, '一周只给两次');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
