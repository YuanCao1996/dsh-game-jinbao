import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildFactsBlock, parseDiaryReply, trimBody, writeDiary, charCount, openingOf } from '../diary-write.mjs';
import { decide } from '../diary-day.mjs';

const facts = {
  day: '2026-11-15',
  matches: [
    { champion: '星籁歌姬', result: 'win', seconds: 992, kda: { k: 6, d: 10, a: 49 }, adviceRevoked: 3 },
    { champion: '安妮', result: null, seconds: 600, kda: null, adviceRevoked: 0 },
  ],
  selfChats: ['打野来下路', '别急，我来了'],
  aces: 1, aceLabels: ['团灭'], herLines: ['来啦！这局冲鸭'], appChats: 2, gapDays: 0, firsts: 0,
};

test('事实摘要只给要点，不搬整份日志', () => {
  const block = buildFactsBlock(facts);
  assert.match(block, /打了 2 局/);
  assert.match(block, /星籁歌姬（赢了 6\/10\/49/);
  assert.match(block, /没看清输赢/, '胜负未知就写未知，不能瞎写');
  assert.match(block, /「打野来下路」/);
  assert.match(block, /改过口/);
  assert.match(block, /找过你 2 次/);
  assert.ok(block.length < 300, '摘要要短：' + block.length);
});

test('提示词留足预算（角色设定另有 2000 字符上限）且写清长度与格式', () => {
  const decision = decide({ facts, day: facts.day });
  const prompt = buildPrompt({ day: facts.day, facts, decision, role: '柳如风', recent: ['今天他玩了星籁歌姬', '十六分钟'] });
  assert.ok(prompt.length <= 1500, 'prompt 太长：' + prompt.length);
  assert.match(prompt, /柳如风/);
  assert.match(prompt, /长度 \d+—\d+ 字/);
  assert.match(prompt, /"title"/);
  assert.match(prompt, /别重样/);
  assert.match(prompt, /不要出现其他玩家昵称/);
  const strict = buildPrompt({ day: facts.day, facts, decision, role: '金宝', strict: true });
  assert.match(strict, /只准输出这个 JSON/);
});

test('正文按句子边界截断，不把话砍半截', () => {
  const text = '第一句话说完了。第二句话也说完了。第三句话还没说完就被截断';
  const cut = trimBody(text, 20);
  assert.equal([...cut].length <= 20, true);
  assert.ok(cut.endsWith('。'), '应当停在句号上：' + cut);
});

test('回复校验：缺字段、太短、非法情绪都要挡下来', () => {
  const ok = parseDiaryReply(JSON.stringify({ title: '改口三次', body: '今天他玩了星籁歌姬。'.repeat(12), mood: '心虚', line: '明天问问他为什么不出水银' }), { min: 80, max: 450 });
  assert.equal(ok.title, '改口三次');
  assert.equal(ok.mood, '心虚');
  assert.ok(ok.chars >= 80);
  assert.ok(ok.paragraphs.length >= 1);
  assert.equal([...ok.line].length <= 20, true);
  assert.throws(() => parseDiaryReply('不是 JSON'), /没有 JSON/);
  assert.throws(() => parseDiaryReply(JSON.stringify({ title: '短', body: '太短了', mood: '平静' })), /太短/);
  const unknownMood = parseDiaryReply(JSON.stringify({ title: 't', body: '一'.repeat(100), mood: '开心' }), { min: 80, max: 450 });
  assert.equal(unknownMood.mood, '平静', '没见过的情绪回落成平静');
});

test('写不成就是写不成：两次都拿不到合法 JSON 就报错，不落半成品', async () => {
  const decision = decide({ facts, day: facts.day });
  let calls = 0;
  const good = async () => { calls++; return JSON.stringify({ title: '改口三次', body: '他今天一句话都没回我。'.repeat(20), mood: '心虚', line: '明天再讲吧' }); };
  const entry = await writeDiary({ day: facts.day, facts, decision, role: '金宝', ask: good, now: () => 111 });
  assert.equal(calls, 1);
  assert.equal(entry.day, facts.day);
  assert.equal(entry.at, 111);
  assert.equal(entry.role, '金宝');
  assert.ok(openingOf(entry).length > 0);

  let bad = 0;
  await assert.rejects(() => writeDiary({ day: facts.day, facts, decision, ask: async () => { bad++; return '今天天气不错'; } }), error => error.code === 'diary_rejected');
  assert.equal(bad, 2, '只重试一次');

  let unauthorized = 0;
  await assert.rejects(() => writeDiary({ day: facts.day, facts, decision, ask: async () => { unauthorized++; throw Object.assign(Error('Login required'), { status: 401 }); } }));
  assert.equal(unauthorized, 1, '登录失效不重试');
  assert.equal(charCount('金宝'), 2);
});
