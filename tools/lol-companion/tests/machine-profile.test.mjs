import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeProfile, describeMachine, cpuShort, cleanName, realGpus, collectMachineProfile } from '../machine-profile.mjs';

const raw = {
  cpu: '12th Gen Intel(R) Core(TM) i5-12490F', cores: 6, threads: 12, memoryGb: 16,
  manufacturer: 'Colorful Technology And Development Co.,LTD', model: 'BATTLE-AX B760M-GHA WIFI V20',
  os: 'Microsoft Windows 11 家庭中文版',
  gpus: ['OrayIddDriver Device', 'NVIDIA GeForce RTX 4060 Ti', 'GameViewer Virtual Display Adapter'],
  disks: [{ letter: 'C:', totalGb: 150, freeGb: 10 }, { letter: 'D:', totalGb: 1757, freeGb: 429 }],
  screen: '1920x1080',
};

test('只留白名单字段：序列号、MAC、用户名这类绝不进提示词', () => {
  const dirty = { ...raw, serialNumber: 'ABC123', mac: 'AA:BB:CC', userName: 'Administrator', path: 'C:\\Users\\me' };
  const clean = sanitizeProfile(dirty);
  const text = JSON.stringify(clean);
  assert.ok(!text.includes('ABC123'));
  assert.ok(!text.includes('AA:BB'));
  assert.ok(!text.includes('Administrator'));
  assert.ok(!text.includes('C:\\\\Users'));
  assert.deepEqual(Object.keys(clean).sort(), ['cores', 'cpu', 'disks', 'gpus', 'manufacturer', 'memoryGb', 'model', 'os', 'screen', 'threads']);
});

test('虚拟显卡被滤掉，只剩真显卡', () => {
  assert.deepEqual(realGpus(raw.gpus), ['NVIDIA GeForce RTX 4060 Ti']);
  assert.deepEqual(realGpus(['Microsoft Basic Display Adapter']), []);
});

test('CPU 名称压缩成看得懂的短名', () => {
  assert.equal(cpuShort(raw.cpu), 'i5-12490F');
  assert.equal(cpuShort('AMD Ryzen 5 5600X 6-Core Processor'), 'Ryzen 5 5600X');
  assert.equal(cpuShort('Intel(R) Core(TM) Ultra 7 155H'), 'Ultra 7 155H');
});

test('描述是一句话，给模型当「她看到的」', () => {
  const text = describeMachine(sanitizeProfile(raw));
  assert.match(text, /i5-12490F/);
  assert.match(text, /6 核 12 线程/);
  assert.match(text, /16GB 内存/);
  assert.match(text, /RTX 4060 Ti/);
  assert.match(text, /C: 盘 150GB（剩 10GB）/);
  assert.match(text, /1920x1080/);
  assert.match(text, /Windows 11 家庭中文版/);
  assert.ok(!text.includes('BATTLE-AX'), '主板型号不写进描述');
  assert.equal(describeMachine(null), '');
});

test('采集失败就返回 null，不抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mp-'));
  try {
    const failed = await collectMachineProfile({ stateDir: dir, run: async () => { throw Error('no powershell'); } });
    assert.equal(failed, null);
    assert.equal(await collectMachineProfile({ stateDir: dir, run: async () => ({ stdout: '{坏 json' }) }), null);
    // 有缓存时直接用缓存，不再跑采集
    await writeFile(join(dir, 'machine-profile.json'), JSON.stringify(sanitizeProfile(raw)));
    let called = false;
    const cached = await collectMachineProfile({ stateDir: dir, run: async () => { called = true; return { stdout: '{}' }; } });
    assert.equal(called, false);
    assert.match(describeMachine(cached), /i5-12490F/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
