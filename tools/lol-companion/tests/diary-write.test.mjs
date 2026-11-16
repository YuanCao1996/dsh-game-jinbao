import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildFactsBlock, parseDiaryReply, trimBody, writeDiary, charCount, openingOf, sanitizeMarkup } from '../diary-write.mjs';
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

test('语气、洞察、周回顾/节日信都会进提示词', () => {
  const decision = decide({ facts, day: facts.day });
  const withTone = buildPrompt({ day: facts.day, facts, decision, role: '金宝', tone: '今天是圣诞节。可以自然地带到这一点，但别写成贺卡。', insight: '他连输两场之后的那一局，反而更容易赢（4/5）' });
  assert.match(withTone, /圣诞节/);
  assert.match(withTone, /连输两场之后/);
  assert.match(withTone, /别写成数据/);
  const weekly = buildPrompt({ day: facts.day, facts, decision, weekly: true });
  assert.match(weekly, /一周回顾/);
  assert.match(weekly, /不要一天一段地报/);
  const letter = buildPrompt({ day: facts.day, facts, decision, letter: true });
  assert.match(letter, /节日信/);
  assert.match(letter, /落款/);
  assert.ok(withTone.length <= 1500 && weekly.length <= 1500 && letter.length <= 1500);
});

test('素材很长时也不会把 JSON 契约截掉', () => {
  const heavy = {
    day: '2026-11-15',
    matches: Array.from({ length: 6 }, (_, index) => ({ champion: '英雄' + index, result: 'win', seconds: 1200, kda: { k: 9, d: 1, a: 9 }, adviceRevoked: 1 })),
    selfChats: Array.from({ length: 6 }, (_, index) => '这是他说的一句话' + index),
    herLines: ['来啦！这局冲鸭'],
  };
  const decision = decide({ facts: heavy, day: heavy.day });
  const prompt = buildPrompt({ day: heavy.day, facts: heavy, decision, role: '金宝', recent: ['很长的开头'.repeat(6)], tone: '今天是圣诞节。'.repeat(8) });
  assert.ok(prompt.length <= 1500, 'prompt 超预算：' + prompt.length);
  assert.ok(prompt.trimEnd().endsWith('}'), '结尾必须是 JSON 契约');
  assert.match(prompt, /"title"/);
});

test('涂改只放行一处 <del>，其它标签一律扒掉', () => {
  assert.equal(sanitizeMarkup('把<del>鞋子</del>先出成鞋子'), '把<del>鞋子</del>先出成鞋子');
  assert.equal(sanitizeMarkup('<script>alert(1)</script>好'), 'alert(1)好');
  assert.equal(sanitizeMarkup('A<del>一</del>B<del>二</del>C'), 'A<del>一</del>B二C', '只留第一处涂改');
  const parsed = parseDiaryReply(JSON.stringify({ title: '改口', body: '把<del>鞋子</del>换成别的。'.repeat(8), mood: '平静' }), { min: 80, max: 450 });
  assert.equal(parsed.edited, true);
  assert.ok(parsed.chars <= 450);
});
