import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../diary.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];

test('diary page ships the hooks, copy and API contract the settings page expects', () => {
  for (const id of ['diaryList', 'diaryBody', 'diaryTitle', 'diaryMeta', 'diaryCount', 'diaryToggle', 'diaryEmpty']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>金宝日记<\/title>/);
  assert.match(html, /和你一起写了/);
  assert.match(html, /返回设置/);
  assert.match(html, /她还没写过。等今天打完，明天再来看看。/);
  assert.match(html, /日记暂时读不出来/);
  assert.match(html, /重试/);
  assert.match(script, /\/api\/diary/);
  assert.match(script, /X-Jinbao-Setup/);
  assert.match(script, /'\/api\/diary\/settings'/);
  for (const method of ['GET', 'POST', 'DELETE']) assert.match(script, new RegExp(method));
});

test('diary page is a single file and loads nothing from the network', () => {
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /url\(\s*['"]?https?:/i);
});

test('diary body is escaped before it is inserted into the page', () => {
  assert.match(script, /function escape\(/);
  assert.match(script, /replace\(\/&\/g/);
  assert.match(script, /replace\(\/</g);
  assert.match(script, /node\.innerHTML=escape\(paragraph\)/);
  assert.doesNotMatch(script, /innerHTML\s*=\s*[^;]*\bentry\.(body|paragraphs)\b/);
});

test('the inline script parses and restores the settings nonce', () => {
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /const incoming=location\.hash\.slice\(1\);/);
  assert.match(script, /\/\^\[a-f0-9\]\{64\}\$\//);
  assert.match(script, /sessionStorage\.setItem\('jinbao-settings-setup'/);
  assert.ok(script.includes("$('back').href='/#'+nonce;"), 'the back link must carry the nonce');

  const init = script.match(/const incoming=location\.hash\.slice\(1\);[\s\S]*?history\.replaceState\(null,'',location\.pathname\);/)[0];
  const values = new Map();
  const sessionStorage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) };
  const run = hash => vm.runInNewContext(init + '\nnonce', {
    location: { hash, pathname: '/diary' },
    history: { replaceState() {} },
    sessionStorage,
  });
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  assert.equal(run('#' + first), first);
  assert.equal(run(''), first);
  assert.equal(run('#' + second), second);
  assert.equal(run(''), second);
  assert.equal(run('#not-a-nonce'), second);
});

test('页面支持涂改、去年今天和动笔时间', async () => {
  const html = await readFile(new URL('../diary.html', import.meta.url), 'utf8');
  assert.match(html, /diaryLastYear/);
  assert.match(html, /on-this-day/);
  assert.match(html, /&lt;del&gt;/);
  assert.match(html, /diaryEdited/);
  assert.match(html, /<del>\$1<\/del>/);
  assert.match(html, /<style>/);
});

test('renderEntry 在最小 DOM 桩上能完整跑完（0.2.36–0.2.42 的「日记暂时读不出来」就是这么漏掉的）', async () => {
  const html = await readFile(new URL('../diary.html', import.meta.url), 'utf8');
  // 一个裸变量引用（editedNote=diaryEdited）只有真跑一遍函数才抓得到，字符串检查永远漏。
  const script = /function renderEntry\(entry\)\{[\s\S]*?\r?\n\}\r?\n/.exec(html)?.[0];
  assert.ok(script, '找不到 renderEntry');
  const element = () => ({ hidden: true, textContent: '', innerHTML: '', dateTime: '', childElementCount: 0,
    removeAttribute() {}, append() { this.childElementCount++; }, replaceChildren() { this.childElementCount = 0; } });
  const ids = new Map();
  const byId = id => { if (!ids.has(id)) ids.set(id, element()); return ids.get(id); };
  const context = {
    $: byId,
    selected: '2026-11-15',
    parseDay: () => new Date('2026-11-15T12:00:00'),
    fmtFull: () => '2026年11月15日',
    setPanel: () => {},
    escape: value => String(value).replace(/&/g, '&amp;'),
    toDate: () => new Date('2026-11-15T12:13:00'),
    fmtWhen: () => '2026-11-15 12:13',
    document: { createElement: () => element() },
  };
  vm.runInNewContext(script, context);
  // 坏版本在这一行抛 ReferenceError；好版本走到底。
  vm.runInNewContext('renderEntry({day:"2026-11-15",title:"测试",mood:"想念",paragraphs:["一段。"],edited:true,line:"明天见",at:1,role:"金宝",kind:"daily"})', context);
  assert.equal(byId('diaryTitle').textContent, '测试');
  assert.equal(byId('diaryAt').textContent, '2026-11-15 12:13');
  assert.equal(byId('diaryEdited').hidden, false, 'edited=true 时涂改标记要显示');
  assert.equal(byId('diaryLine').textContent, '明天见');
  assert.ok(!/editedNote\s*=\s*diaryEdited;/.test(html), '不许再出现裸变量引用');
});
