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
