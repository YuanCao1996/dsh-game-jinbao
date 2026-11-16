import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, dayRange, shiftDay, stableRoll, scoreDay, probabilityFor, lengthFor, topicFor, decide } from '../diary-day.mjs';

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

test('一天从凌晨 4 点算起：跨午夜的局仍归前一天', () => {
  assert.equal(dayKey(at(2026, 11, 16, 3, 59)), '2026-11-15');
  assert.equal(dayKey(at(2026, 11, 16, 4, 0)), '2026-11-16');
  assert.equal(dayKey(at(2026, 11, 16, 23, 59)), '2026-11-16');
  assert.equal(dayKey(at(2026, 1, 1, 1, 0)), '2025-12-31');
  assert.equal(shiftDay('2026-11-16', -3), '2026-11-13');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  const range = dayRange('2026-11-15');
  assert.equal(range.to - range.from, 86400e3);
  assert.equal(dayKey(range.from), '2026-11-15');
  assert.equal(dayKey(range.to - 1), '2026-11-15');
});

test('同一天的决定是确定的：重跑不会多写一篇', () => {
  const facts = { day: '2026-11-14', matches: [{ champion: '亚索', result: 'lose' }], selfChats: ['打野来下路'] };
  const first = decide({ facts, day: facts.day });
  const second = decide({ facts, day: facts.day });
  assert.equal(first.write, second.write);
  assert.equal(first.roll, second.roll);
  assert.ok(first.roll >= 0 && first.roll <= 1);
  assert.equal(stableRoll('a'), stableRoll('a'));
  assert.notEqual(stableRoll('a'), stableRoll('b'));
});

test('分数只由真实发生的事决定；什么都没发生就不写', () => {
  assert.deepEqual(scoreDay({}), { score: 0, reasons: ['今天什么都没发生'] });
  assert.equal(decide({ facts: { day: '2026-11-14' }, day: '2026-11-14' }).write, false);
  const quiet = scoreDay({ matches: [{}, {}] });
  assert.equal(quiet.score, 2);
  const chatty = scoreDay({ matches: [{}, {}, {}], selfChats: ['a', 'b'], aces: 1, gapDays: 4 });
  assert.equal(chatty.score, 3 + 4 + 2 + 2);
  assert.ok(chatty.reasons.includes('隔了几天才见'));
});

test('概率与长度分档', () => {
  assert.equal(probabilityFor(0), 0.12);
  assert.equal(probabilityFor(2), 0.12);
  assert.equal(probabilityFor(5), 0.45);
  assert.equal(probabilityFor(10), 0.7);
  assert.equal(probabilityFor(20), 0.85);
  assert.deepEqual(lengthFor(2), { bucket: 'short', min: 80, max: 150 });
  assert.deepEqual(lengthFor(5), { bucket: 'medium', min: 150, max: 280 });
  assert.deepEqual(lengthFor(9), { bucket: 'long', min: 280, max: 450 });
});

test('主题挑当天最强的信号，不会篇篇都写「打了几局」', () => {
  assert.equal(topicFor({ gapDays: 4 }, [{ result: 'lose' }]), 'reunion');
  assert.equal(topicFor({ aces: 1 }, [{}]), 'ace');
  assert.equal(topicFor({ selfChats: ['x', 'y'] }, [{}]), 'chat');
  assert.equal(topicFor({}, [{ result: 'lose' }, { result: 'lose' }]), 'loss');
  assert.equal(topicFor({}, [{ result: 'win' }]), 'champion');
  assert.equal(topicFor({}, []), 'silence');
});
