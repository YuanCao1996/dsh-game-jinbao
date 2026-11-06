import test from 'node:test';
import assert from 'node:assert/strict';
import {stripViewSources} from '../overlay-state.mjs';

// 战况页实测：thread 是对象数组，只遍历顶层字符串会漏掉数组里的正文，
// 于是「来源 + 链接」照样显示出来。
const dirty = {
 advice: '先补虚空之杖。来源Hexdata Patch 16.21，版本未经核实，仅供参考。',
 equipment: '推荐出装\n**卢登的回声** 来源（版本未核实）：https://hexdata.com.cn/hero/887-gwen',
 thread: [
  {role: 'user', origin: 'desktop', text: '对面谁厉害'},
  {role: 'assistant', origin: 'coach', text: '**阿卡丽** 4/2/4。来源 https://aramgg.com/zh-CN/new-augments', at: 1},
  {role: 'assistant', origin: 'coach', text: '正常的一句建议。', at: 2},
 ],
 meta: {note: '嵌套对象里的来源 https://example.com 也要清', list: ['**加粗** 文本']},
 players: ['T1  赫卡里姆  58.1%'],
};

test('视图递归剥离：字符串、数组、嵌套对象里的来源/链接/Markdown 全部清掉', () => {
 const view = stripViewSources(dirty);
 const flat = JSON.stringify(view);
 assert.doesNotMatch(flat, /https?:\/\//);
 assert.doesNotMatch(flat, /来源/);
 assert.doesNotMatch(flat, /\*\*/);
 // 正常内容必须保留
 assert.match(view.thread[2].text, /正常的一句建议/);
 assert.deepEqual(view.players, dirty.players);
 assert.equal(view.thread.length, 3, '数组结构不能被打散');
});

test('已是干净的视图保持原样（不误伤）', () => {
 const clean = {advice: '先补虚空之杖。', thread: [{role: 'assistant', text: '稳住节奏。'}]};
 assert.deepEqual(stripViewSources(clean), clean);
});
