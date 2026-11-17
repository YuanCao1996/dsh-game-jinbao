import test from 'node:test';
import assert from 'node:assert/strict';
import { weekKey, isStale, acceptTerm, acceptTopic, extractTerms, summarize, topicPrompt } from '../diary-trends.mjs';

const at = (y, m, d) => new Date(y, m - 1, d, 21, 0, 0).getTime();

test('ISO 周：同一周只算一次，跨周才算旧', () => {
  assert.equal(weekKey(at(2026, 11, 16)), '2026-W47');
  assert.equal(weekKey(at(2026, 11, 22)), '2026-W47', '周日仍属同一周');
  assert.equal(weekKey(at(2026, 11, 23)), '2026-W48');
  assert.equal(weekKey(at(2026, 1, 1)), '2026-W01');
  assert.equal(isStale(null, at(2026, 11, 16)), true);
  assert.equal(isStale({ week: '2026-W47' }, at(2026, 11, 18)), false);
  assert.equal(isStale({ week: '2026-W46' }, at(2026, 11, 18)), true);
});

test('只收像梗的中文短词：太长、太敏感、像广告的都不要', () => {
  assert.equal(acceptTerm('泰裤辣'), '泰裤辣');
  assert.equal(acceptTerm('「尊嘟假嘟」'), '尊嘟假嘟');
  assert.equal(acceptTerm(''), null);
  assert.equal(acceptTerm('啊'), null, '一个字不成梗');
  assert.equal(acceptTerm('这个说法长到已经不像一个梗了'), null);
  assert.equal(acceptTerm('疫情'), null, '敏感/时事过滤');
  assert.equal(acceptTerm('点击下载APP'), null);
  assert.equal(acceptTerm('1234'), null, '纯数字不要');
  assert.equal(acceptTerm('ABCD'), null, '纯英文不要');
});

test('从搜索标题和摘要里捞出引号里的说法和 xx 体/文学/梗', () => {
  const texts = [
    '本周热梗盘点：「泰裤辣」为什么火',
    '网友又造出新词，尊嘟假嘟体走红',
    '「你说得对但是」句式刷屏',
    '某地发生事故（这条不该进来）',
  ];
  const terms = extractTerms(texts);
  assert.ok(terms.includes('泰裤辣'), JSON.stringify(terms));
  assert.ok(terms.includes('尊嘟假嘟'), JSON.stringify(terms));
  assert.ok(!terms.some(term => term.includes('事故')), JSON.stringify(terms));
  assert.ok(terms.length <= 6);
  assert.deepEqual(extractTerms([]), []);
});

test('空记录也要能总结，最多留五条', () => {
  assert.deepEqual(summarize(null), { week: '', items: [], topics: [], at: 0 });
  const summary = summarize({ week: '2026-W47', at: 5, items: ['泰裤辣', '疫情', '尊嘟假嘟'] });
  assert.deepEqual(summary.items, ['泰裤辣', '尊嘟假嘟'], '存过的脏数据读出来再过滤一遍');
  assert.equal(summary.week, '2026-W47');
});

test('话题兜底：只要「在聊什么」，不要比分和胜负', () => {
  assert.equal(acceptTopic('新英雄上线'), '新英雄上线');
  assert.equal(acceptTopic('版本更新后的打野'), '版本更新后的打野');
  assert.equal(acceptTopic('BLG 3:1 夺冠'), null, '比分不要');
  assert.equal(acceptTopic('BLG夺冠'), null, '胜负结果不要');
  assert.equal(acceptTopic('短'), null);
  assert.equal(acceptTopic('这是一个特别特别长的话题名称超过上限'), null);
  const prompt = topicPrompt(['新英雄上线', 'BLG 3:1 夺冠', '新赛季改动']);
  assert.ok(prompt);
  assert.ok(prompt.includes('新英雄上线'));
  assert.ok(!prompt.includes('3:1'), '比分不进提示词');
  assert.ok(prompt.includes('只输出 JSON 数组'));
  assert.equal(topicPrompt([]), null);
});

test('summarize 会把话题一起带出来，脏数据读出来再过滤一遍', () => {
  const summary = summarize({ week: '2026-W47', at: 5, items: [], topics: ['新英雄上线', 'BLG夺冠'] });
  assert.deepEqual(summary.topics, ['新英雄上线']);
  assert.deepEqual(summary.items, []);
});
