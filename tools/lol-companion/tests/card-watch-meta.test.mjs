import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCardWatchDir } from '../card-watch-dir.mjs';

test('meta 只写进这一轮自己的 card-watch 目录', () => {
  const started = 1795011152283;
  const names = [
    'card-watch-1795011151934-undecided-panel-closed', // 本轮：比 startedAt 早 349ms
    'card-watch-1795011155068-undecided-panel-closed', // 下一轮：晚 2.7 秒
    'card-watch-1794990000000-old',
    'card-watch-archive-match1',
    'logs',
  ];
  assert.equal(pickCardWatchDir(names, started), 'card-watch-1795011151934-undecided-panel-closed');
  assert.equal(pickCardWatchDir(['card-watch-1795011155068-x'], started), 'card-watch-1795011155068-x', '只有下一轮时也只能写它');
  assert.equal(pickCardWatchDir(['card-watch-1794990000000-old'], started), null, '太旧的不写');
  assert.equal(pickCardWatchDir(['card-watch-archive-match1', 'logs'], started), null, '没有时间戳的目录一律不写');
});
