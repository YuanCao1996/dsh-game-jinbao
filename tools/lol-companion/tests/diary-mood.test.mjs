import test from 'node:test';
import assert from 'node:assert/strict';
import { festivalOn, timeBand, absenceLevel, anniversaryOf, toneGuidance } from '../diary-mood.mjs';

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

test('节日只认固定公历的那几个，不猜农历', () => {
  assert.equal(festivalOn('2026-12-25')?.label, '圣诞节');
  assert.equal(festivalOn('2026-12-24')?.label, '平安夜');
  assert.equal(festivalOn('2026-02-14')?.label, '情人节');
  assert.equal(festivalOn('2026-10-01')?.label, '国庆节');
  assert.equal(festivalOn('2026-12-26'), null);
  assert.equal(festivalOn('bad'), null);
});

test('时段：深夜、凌晨、上午、下午、晚上', () => {
  assert.equal(timeBand(at(2026, 11, 16, 23, 30)), 'late-night');
  assert.equal(timeBand(at(2026, 11, 17, 1, 0)), 'late-night');
  assert.equal(timeBand(at(2026, 11, 17, 3, 0)), 'small-hours');
  assert.equal(timeBand(at(2026, 11, 16, 8, 0)), 'morning');
  assert.equal(timeBand(at(2026, 11, 16, 15, 0)), 'afternoon');
  assert.equal(timeBand(at(2026, 11, 16, 20, 0)), 'evening');
});

test('缺席越久情绪越重：两天和两周不能一个语气', () => {
  assert.equal(absenceLevel({ daysSinceLastPlay: 0 }).level, 'normal');
  assert.equal(absenceLevel({ daysSinceLastPlay: 1 }).level, 'normal', '昨天还一起玩，不算缺席');
  assert.equal(absenceLevel({ daysSinceLastPlay: 2 }).level, 'miss');
  assert.equal(absenceLevel({ daysSinceLastPlay: 4 }).level, 'complain');
  assert.equal(absenceLevel({ daysSinceLastPlay: 8 }).level, 'sad');
  assert.equal(absenceLevel({ daysSinceLastPlay: 20 }).level, 'cry');
  assert.match(absenceLevel({ daysSinceLastPlay: 20 }).hint, /绝不指责/);
  // 还在玩，但明显来得少了
  assert.equal(absenceLevel({ daysSinceLastPlay: 1, recentGames: 2, priorGames: 9 }).level, 'fading');
  assert.equal(absenceLevel({ daysSinceLastPlay: 1, recentGames: 8, priorGames: 9 }).level, 'normal');
});

test('第一百天、一周年这类里程碑', () => {
  assert.equal(anniversaryOf({ today: '2026-11-16', first: '2026-08-08' })?.label, '第一百天');
  assert.equal(anniversaryOf({ today: '2026-11-16', first: '2025-11-16' })?.label, '一周年');
  assert.equal(anniversaryOf({ today: '2026-11-16', first: '2026-11-01' }), null);
  assert.equal(anniversaryOf({ today: '2026-11-16', first: null }), null);
});

test('把情绪、节日、时段合成一句给模型的话', () => {
  const tone = toneGuidance({
    absence: absenceLevel({ daysSinceLastPlay: 5 }),
    festival: festivalOn('2026-12-25'),
    band: 'late-night',
    anniversary: null,
  });
  assert.match(tone, /圣诞节/);
  assert.match(tone, /数着日子/);
  assert.match(tone, /深夜/);
  const letter = toneGuidance({ festival: festivalOn('2026-12-25'), holidayGreeting: true });
  assert.match(letter, /这是一封节日信/);
  assert.equal(toneGuidance({ band: 'day' }), '');
});

test('日期、星期、季节、动笔时刻都会变成一句提示', async () => {
  const { weekdayOf, seasonOf, clockHint, dayHint } = await import('../diary-mood.mjs');
  assert.equal(weekdayOf('2026-11-15'), '周日');
  assert.equal(seasonOf('2026-11-15'), '秋天');
  assert.equal(seasonOf('2026-01-09'), '冬天');
  assert.equal(clockHint(at(2026, 11, 15, 23, 47)), '23:47');
  const hint = dayHint({ day: '2026-11-15', at: at(2026, 11, 15, 23, 47) });
  assert.match(hint, /周日/);
  assert.match(hint, /23:47/);
});
