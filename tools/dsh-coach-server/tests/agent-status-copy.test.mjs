import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentStatus } from '../lib/agent-status.js';

async function labelFor(phase, name) {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-status-'));
  await createAgentStatus(dir, 'lol', 'm1')(phase, name);
  return JSON.parse(await readFile(join(dir, 'agent-status.json'), 'utf8')).label;
}

test('tool steps read like a person, not a log line', async t => {
  const cases = [
    ['inspect_latest_screen', '看一眼游戏画面'],
    ['game_log_query', '翻翻这局的日志'],
    ['web_search', '上网查一下'],
    ['site_query', '翻一下资料库'],
    ['game_memory_query', '回想一下之前的局'],
    ['game_memory_save', '记住这个偏好'],
  ];
  for (const [tool, phrase] of cases) {
    const label = await labelFor('tool', tool);
    assert.ok(label.startsWith(phrase), `${tool} -> ${label}`);
    assert.ok(!/已处理|已检索|已读取|已保存/.test(label), `${tool} must not read like a log: ${label}`);
  }
});

test('an unknown tool still speaks instead of falling back to "organising an answer"', async () => {
  const label = await labelFor('tool', 'brand_new_tool');
  assert.equal(label, '理一下思路…');
  assert.doesNotMatch(label, /整理回答/);
});

test('the opening step and the completion step are distinct', async () => {
  assert.equal(await labelFor('start'), '正在想这局该怎么打');
  assert.equal(await labelFor('complete'), '');
});

test('failure text is preserved verbatim: copy polish must never hide it', async () => {
  const label = await labelFor('error');
  assert.match(label, /模型请求失败/);
  assert.match(label, /设置查看诊断/);
});

test('the single-line panel is never fed an over-long phrase', async () => {
  const label = await labelFor('tool', 'site_datasets');
  assert.ok(label.length <= 25, `label too long for one line: ${label.length}`);
});
