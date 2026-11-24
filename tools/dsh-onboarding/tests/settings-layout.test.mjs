import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8');

function harness() {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    hidden: false, value: '', textContent: '', disabled: false, dataset: {}, addEventListener() {},
    classList: { toggle() {} }, querySelector() { return { textContent: '' }; },
  }]));
  let status = { mode: 'cloud', baseUrl: '', model: '', emailEnabled: true, agentRuntime: 'standalone' };
  let requests = [];
  let stream = {};
  const context = vm.createContext({ URL, Date, console, location: { hash: '#test', pathname: '/' },
    history: { replaceState() {} }, document: { hidden: false, getElementById: id => elements.get(id) },
    setInterval() {}, setTimeout() {}, clearTimeout() {}, window: {},
    fetch: async (url, options = {}) => {
      if (url === '/api/status') return Response.json(status);
      if (url === '/api/stream') return Response.json(stream);
      if (url === '/api/model') {
        const body = JSON.parse(options.body); requests.push(body);
        status = { ...status, ...body, apiKey: undefined, byokConfigured: true };
      }
      return Response.json({});
    },
  });
  for(const [id,element] of elements){context[id]=element;element.setAttribute=()=>{};element.removeAttribute=()=>{};}
  context.window.fetch=context.fetch;context.window.addEventListener=()=>{};
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], context);
  return { elements, context, requests, setStream(value) {stream=value;}, async refresh() { await vm.runInContext('refresh(true)', context); } };
}

test('settings script compiles; security nonce and existing diagnostics are preserved', () => {
  new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  assert.match(html, /X-Jinbao-Setup/);
  for (const id of ['markIssue', 'exportDiagnostics', 'testDiagnostics', 'releaseDetails', 'agentActivityEnabled']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.equal(new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])).size,
    [...html.matchAll(/id="([^"]+)"/g)].length, 'no duplicate IDs');
});

test('polling and forced login refresh preserve an unsaved model draft; discard restores server values', async () => {
  const h = harness(); await h.refresh();
  h.elements.get('mode').value = 'byok';
  h.elements.get('baseUrl').value = 'https://example.com/v1';
  h.elements.get('model').value = 'draft-model';
  h.elements.get('apiKey').value = 'test-only-key';
  await h.refresh();
  assert.equal(h.elements.get('model').value, 'draft-model');
  assert.equal(h.elements.get('apiKey').value, 'test-only-key');
  assert.equal(vm.runInContext('modelDirty()', h.context), true);
  h.elements.get('discardModel').onclick();
  assert.equal(h.elements.get('mode').value, 'cloud');
  assert.equal(h.elements.get('apiKey').value, '');
  assert.equal(h.elements.get('save').disabled, true);
});

test('invalid model fields send no request; successful save clears key and dirty state', async () => {
  const h = harness(); await h.refresh();
  h.elements.get('mode').value = 'byok';
  await h.elements.get('save').onclick();
  assert.equal(h.requests.length, 0);
  h.elements.get('baseUrl').value = 'https://example.com/v1';
  h.elements.get('model').value = 'test-model';
  h.elements.get('apiKey').value = 'test-only-key';
  await h.elements.get('save').onclick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.elements.get('apiKey').value, '');
  assert.equal(h.elements.get('save').disabled, true);
  assert.equal(h.elements.get('modelSaveState').textContent, '设置已保存');
});

test('stream hint distinguishes local answers, actual cloud answers and uncertain tasks', async()=>{
 const h=harness();
 const base={enabled:true,status:'authorized',roomId:'2948407',metrics:{received:1,accepted:1,replied:1}};
 for(const [extra,expected] of [
   [{audienceAgent:{configured:false}},/本地简短回复/],
   [{audienceAgent:{configured:true},metrics:{...base.metrics,lastReplySource:'agent'}},/最近一条由云端/],
   [{audienceAgent:{configured:true,transport:{uncertain:true}}},/状态待确认.*暂停/],
   [{audienceAgent:{configured:true,transport:{busy:true}}},/正在回答/],
 ]){
   h.setStream({...base,...extra});
   await vm.runInContext('loadStreamSettings(false)',h.context);
   assert.match(h.elements.get('streamHint').textContent,expected);
   assert.equal(h.elements.get('streamRecover').hidden,extra.audienceAgent?.transport?.uncertain!==true);
 }
});
