import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
function request(t, values) {
  const directory=mkdtempSync(join(tmpdir(),'ultra-release-inputs-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const output=join(directory,'output');
  const result=spawnSync(process.execPath,[new URL('../scripts/release-inputs.mjs',import.meta.url).pathname],{
    encoding:'utf8', timeout:5000,
    env:{...process.env,CHANNEL:'',SOURCE_SHA:'',SOURCE_TAG:'',TEST_VERSION:'',...values,GITHUB_OUTPUT:output}
  });
  return {status:result.status, values:result.status===0?Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];})):null};
}
test('stable dispatch pins a tag and complete platform matrix',t=>{
 const r=request(t,{CHANNEL:'stable',SOURCE_TAG:'v0.1.1'});assert.equal(r.status,0);assert.equal(r.values.ref,'v0.1.1');assert.equal(JSON.parse(r.values.matrix).include.length,3);
});
test('test dispatch accepts exact non-main SHA and macOS only',t=>{
 const sha='a'.repeat(40);const r=request(t,{CHANNEL:'updater-test',SOURCE_SHA:sha,TEST_VERSION:'0.1.1-updater.2'});assert.equal(r.status,0);assert.equal(r.values.ref,sha);assert.deepEqual(JSON.parse(r.values.matrix).include.map(x=>x.platform),['darwin-aarch64']);
});
test('ambiguous inputs and invalid channels or versions fail closed',t=>{
 for(const values of [
  {CHANNEL:'stable',SOURCE_TAG:'v0.1.1-updater.1'},
  {CHANNEL:'stable',SOURCE_TAG:'v0.1.1',SOURCE_SHA:'a'.repeat(40)},
  {CHANNEL:'updater-test',SOURCE_SHA:'main',TEST_VERSION:'0.1.1-updater.1'},
  {CHANNEL:'updater-test',SOURCE_SHA:'a'.repeat(40),TEST_VERSION:'0.1.1'},
  {CHANNEL:'updater-test',SOURCE_SHA:'a'.repeat(40),TEST_VERSION:'0.1.1-updater.1',SOURCE_TAG:'v0.1.1'},
  {CHANNEL:'other'},
 ]) assert.notEqual(request(t,values).status,0);
});
