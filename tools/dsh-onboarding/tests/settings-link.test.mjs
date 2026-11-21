import test from 'node:test';
import assert from 'node:assert/strict';
import {saveSettingsLink} from '../server.mjs';
test('denied optional navigation cache never changes permissions or returns the secret URL',async()=>{
 for(const code of ['EPERM','EACCES']){
  let calls=0;
  const result=await saveSettingsLink('fixture-path','fixture-private-url',async()=>{calls++;throw Object.assign(Error('private details'),{code});});
  assert.equal(result,false);assert.equal(calls,1);
 }
});
test('successful cache preserves restrictive mode and unexpected failures stay explicit',async()=>{
 assert.equal(await saveSettingsLink('fixture-path','fixture-url',async(path,url,options)=>{assert.equal(options.mode,0o600);assert.equal(path,'fixture-path');assert.equal(url,'fixture-url');}),true);
 await assert.rejects(saveSettingsLink('fixture','fixture',async()=>{throw Object.assign(Error('disk full'),{code:'ENOSPC'});}),/disk full/);
});
