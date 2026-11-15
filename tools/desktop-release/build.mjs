import { readFileSync,writeFileSync,readdirSync,mkdirSync,copyFileSync,existsSync,statSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { join,resolve,dirname,relative } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { assertReleaseRuntime } from './runtime-policy.mjs';
assertReleaseRuntime(process.version);
if(process.platform!=='win32')throw Error('Windows release builds must run on Windows');
const root=resolve('.'),out=resolve(process.argv[2]??'workspace/client-releases/jinbao-desktop');
if(existsSync(out))throw Error('Choose a new output directory; existing releases are never overwritten');
mkdirSync(join(out,'tools'),{recursive:true});
for(const name of ['dsh-onboarding','dsh-game-services','dsh-coach-server','desktop-release','jinbao-launcher']){
 const from=join(root,'tools',name);
 await cp(from,join(out,'tools',name),{recursive:true,filter:p=>!relative(from,p).split(/[\\/]/).some(part=>part==='tests'||part.includes('.bak'))&&!p.endsWith('build.mjs')&&!p.endsWith('update-metadata.mjs')});
}
// lol-companion / team-room / shared 是 install.mjs 要装进 DSH profiles 的插件，
// 必须整目录带 package.json 一起打；以前按硬编码清单挑文件，结果：
//   1) 这三个目录没有 package.json，install.mjs 的「Missing release plugin」必然抛错（0.1.55 就装不上）
//   2) 清单是旧的，danmaku-bridge / item-policy / partner-index / viewer-reply 这几个新模块全漏了
for(const name of ['lol-companion','team-room','shared']){
 const from=join(root,'tools',name);
 await cp(from,join(out,'tools',name),{recursive:true,filter:p=>!relative(from,p).split(/[\\/]/).some(part=>part==='tests'||part.includes('.bak'))});
}
// install.mjs 还会从 tools/cloud-desktop 取这两个无副作用的小工具塞进 profiles，
// 少了它们装到一半就 ENOENT（实测卡在这里）。整目录不打，只带这两个文件。
mkdirSync(join(out,'tools','cloud-desktop'),{recursive:true});
for(const name of ['user-memory.mjs','shutdown.mjs'])copyFileSync(join(root,'tools/cloud-desktop',name),join(out,'tools/cloud-desktop',name));
const req=createRequire(join(root,'package.json')),packages=new Set();
function walk(dir,includeModules=false){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'&&!includeModules?[]:walk(join(dir,e.name),includeModules)):[join(dir,e.name)]);}
async function bundle(name){
 if(packages.has(name)||name.startsWith('node:'))return;
 let manifest;try{manifest=req.resolve(name+'/package.json');}catch{let f=req.resolve(name);while(!existsSync(join(dirname(f),'package.json')))f=dirname(f);manifest=join(dirname(f),'package.json');}
 const dir=dirname(manifest),pkg=JSON.parse(readFileSync(manifest));packages.add(name);
 const dest=join(out,'node_modules',name);await cp(dir,dest,{recursive:true,filter:p=>!relative(dir,p).split(requireSeparator()).some(part=>part==='node_modules'||part==='test'||part==='tests')&&!p.endsWith('.map')&&!p.endsWith('.ts')});
 for(const file of walk(dir).filter(f=>f.endsWith('.js')||f.endsWith('.mjs')||f.endsWith('.cjs'))){
  const text=readFileSync(file,'utf8');
  for(const m of text.matchAll(/(?:from\s*|import\s*\(|require\s*\(|import\s*)['"]([^'"]+)['"]/g)){
   const spec=m[1];if(/\s/.test(spec)||!/^(@[\w.-]+\/)?[\w.-]+(?:\/[\w./-]+)?$/.test(spec))continue;if(spec.startsWith('.')||spec.startsWith('/')||spec.startsWith('node:')||!spec.includes('/')){if(!spec.startsWith('.')&&['yaml','chokidar','cosmokit','cordis','schemastery','undici','ipaddr.js'].includes(spec))await bundle(spec);continue;}
   await bundle(spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]);
  }
 }
}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
for(const name of ['@deepseek-ai/schemastery','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-session','@deepseek-ai/dsh-web-fetch-http','yaml'])await bundle(name);
mkdirSync(join(out,'runtime'),{recursive:true});copyFileSync(process.execPath,join(out,'runtime','node.exe'));
const license=join(dirname(process.execPath),'LICENSE');
const nodeLicense=existsSync(license)?license:join(root,'third-party/node-LICENSE.txt');
copyFileSync(nodeLicense,join(out,'runtime','LICENSE'));
mkdirSync(join(out,'runtime/platform-tools'),{recursive:true});
if(!process.env.JINBAO_BUILD_ADB_DIR)throw Error('Set JINBAO_BUILD_ADB_DIR to your Android platform-tools directory');
const adbSource=resolve(process.env.JINBAO_BUILD_ADB_DIR);
for(const name of ['adb.exe','AdbWinApi.dll','AdbWinUsbApi.dll','NOTICE.txt'])copyFileSync(join(adbSource,name),join(out,'runtime/platform-tools',name));
copyFileSync(join(root,'LICENSE'),join(out,'LICENSE'));
writeFileSync(join(out,'start-jinbao.vbs'),'Option Explicit\r\nDim shell, fs, root, command\r\nSet shell = CreateObject("WScript.Shell")\r\nSet fs = CreateObject("Scripting.FileSystemObject")\r\nroot = fs.GetParentFolderName(WScript.ScriptFullName)\r\ncommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & root & "\\tools\\jinbao-launcher\\start.ps1" & Chr(34)\r\nshell.Run command, 0, False\r\n');
writeFileSync(join(out,'开始使用.cmd'),'@echo off\r\nwscript.exe "%~dp0start-jinbao.vbs"\r\n');
copyFileSync(join(root,'docs/QUICKSTART.md'),join(out,'README.md'));
const releaseVersion=JSON.parse(readFileSync(join(root,'package.json'))).version;
const notesPath=join(root,'docs','RELEASE_V'+releaseVersion.replaceAll('.','_')+'.md');
if(!existsSync(notesPath)||!readFileSync(notesPath,'utf8').trim())throw Error('Release notes required: '+notesPath);
writeFileSync(join(out,'tools/dsh-onboarding/release-notes.json'),JSON.stringify({version:releaseVersion,notes:readFileSync(notesPath,'utf8').slice(0,4000)}));
const files=walk(out,true).map(f=>({path:f.slice(out.length+1).replaceAll('\\','/'),bytes:statSync(f).size,sha256:createHash('sha256').update(readFileSync(f)).digest('hex')}));
writeFileSync(join(out,'manifest.json'),JSON.stringify({version:JSON.parse(readFileSync(join(root,'package.json'))).version,node:process.version,packages:[...packages],files},null,2));
console.log(JSON.stringify({out,files:files.length,packages:packages.size,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
