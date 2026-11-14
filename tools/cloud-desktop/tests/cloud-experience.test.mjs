import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExperienceToolkit, experienceCallback } from '../experience-tools.mjs';
import { createCloudAgent } from '../cloud-agent.mjs';

function fakeCloud({ eventsFor, onResult }) {
  let polls = 0;
  const created = [];
  return {
    created,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/tasks')) { created.push(JSON.parse(options.body)); return Response.json({ task_id: 'a'.repeat(32) }); }
      if (path.endsWith('/experience-results')) { onResult?.(path, JSON.parse(options.body)); return Response.json({ accepted: true }); }
      if (path.endsWith('/context')) return Response.json({});
      polls += 1;
      const payload = eventsFor(polls);
      return payload ? Response.json({ status: 'running', cursor: polls, events: payload })
                     : Response.json({ status: 'completed', cursor: polls, events: [], reply: '好' });
    },
  };
}

test('cloud agent reads private experience through the local callback', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-xp-cloud-list-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const kit = createExperienceToolkit({ dir, player: 'local' });
  await kit.saveMd({ kind: 'preference', mdText: '- [0.6|2局|candidate] 喜欢激进开团\n' });
  const seen = [];
  const cloud = fakeCloud({
    eventsFor: (n) => (n === 1 ? [{ event: 'experience_requested', request_id: 'b'.repeat(32), args: { action: 'list' } }] : null),
    onResult: (_p, body) => seen.push(body.result),
  });
  const agent = createCloudAgent({
    getToken: async () => 'token',
    getContext: async () => ({ current: { game: 'lol', match: 'one', at: 123, me: {} } }),
    experienceTools: experienceCallback(kit),
    pollMs: 1,
    fetchImpl: cloud.fetchImpl,
  });
  t.after(agent.close);

  assert.equal(await agent.ask({ game: 'lol', match: 'one', topic: 'chat', question: '我平时怎么打？' }), '好');
  assert.equal(cloud.created[0].context.client_context.capabilities.experience_v1, true, 'capability must be advertised');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'ok');
  assert.equal(seen[0].lessons[0].claim, '喜欢激进开团');
  assert.equal(seen[0].lessons[0].games, 1);
});

test('a cloud edit request rewrites the local md and reports retire/add counts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-xp-cloud-edit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const kit = createExperienceToolkit({ dir, player: 'local' });
  await kit.saveMd({ kind: 'pitfall', mdText: '- [0.5|1局|candidate] 五分钟后单独推线被抓\n' });
  const seen = [];
  const cloud = fakeCloud({
    eventsFor: (n) => (n === 1 ? [{ event: 'experience_requested', request_id: 'c'.repeat(32),
      args: { action: 'edit', kind: 'pitfall', source: '五分钟后单独推线被抓', to: '五分钟后先退塔等兵线', reason: '14.21 该机制已改' } }] : null),
    onResult: (_p, body) => seen.push(body.result),
  });
  const agent = createCloudAgent({
    getToken: async () => 'token',
    getContext: async () => ({ current: { game: 'lol', match: 'one', at: 123, me: {} } }),
    experienceTools: experienceCallback(kit),
    pollMs: 1,
    fetchImpl: cloud.fetchImpl,
  });
  t.after(agent.close);

  assert.equal(await agent.ask({ game: 'lol', match: 'one', topic: 'chat', question: '这条经验过时了吗？' }), '好');
  assert.equal(seen[0].status, 'ok');
  assert.equal(seen[0].retired, 1);
  assert.equal(seen[0].added, 1);
  assert.equal(seen[0].claim, '五分钟后先退塔等兵线');
  assert.match(await readFile(join(dir, 'experience', 'private', 'local', 'pitfall.md'), 'utf8'), /先退塔等兵线/);
});

test('the callback refuses shared kinds and missing reasons', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jinbao-xp-cloud-guard-'));
  try {
    const kit = createExperienceToolkit({ dir, player: 'local' });
    const call = experienceCallback(kit);
    assert.equal((await call({ args: { action: 'edit', kind: 'build', source: '甲', to: '乙', reason: '想改一下' } })).reason, 'private-only');
    assert.equal((await call({ args: { action: 'edit', kind: 'pitfall', source: '甲', to: '乙', reason: '' } })).reason, 'reason-required');
    assert.equal((await call({ args: { action: 'nope' } })).reason, 'invalid_action');
  } finally { await rm(dir, { recursive: true, force: true }); }
});