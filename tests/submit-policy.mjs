import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const workflow=readFileSync(new URL('../.github/workflows/run.yml',import.meta.url),'utf8');
const ship=workflow.split('      - name: Ship\n')[1].split('      - name:')[0];
const run=ship.split('        run: |\n')[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
assert.ok(run.includes('eas submit'), 'test executes the actual workflow Ship body');
const complete=workflow.split('      - name: "Milestone: ship complete"')[1].split('      - name:')[0];
assert.ok(complete.includes('inputs.wait_for_submission'), 'queued delivery must not emit ship complete');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
assert.ok(process.platform!=='win32'||existsSync(bash));
const dir=mkdtempSync(join(tmpdir(),'ios-submit-policy-'));
try {
  const invoke=(platform,wait,contract=false)=>{
    const cwd=join(dir,`${platform}-${wait}-${contract}`);mkdirSync(cwd,{recursive:true});
    if(contract){mkdirSync(join(cwd,'store'));writeFileSync(join(cwd,'store/runtime-contract.json'),'{}');}
    const result=spawnSync(bash,['-c',`eas() { printf 'ARG:%s\\n' "$@"; };\n${run}`],{cwd,encoding:'utf8',env:{...process.env,SUBMIT_PLATFORM:platform,SUBMIT_PROFILE:'production',WAIT_FOR_SUBMISSION:wait,RUNNER_TEMP:'/tmp/runner with spaces'}});
    return {status:result.status,output:result.stdout+result.stderr};
  };
  const detached=invoke('ios','false');assert.equal(detached.status,0,detached.output);assert.match(detached.output,/ARG:--no-wait/);assert.match(detached.output,/NOT yet verified/);assert.match(detached.output,/ARG:\/tmp\/runner with spaces\/out.ipa/);
  for(const [platform,contract] of [['ios',false],['ios',true],['android',false]]){
    const r=invoke(platform,'true',contract);assert.equal(r.status,0,r.output);assert.doesNotMatch(r.output,/ARG:--no-wait/);
  }
  for(const [platform,wait,contract] of [['android','false',false],['ios','false',true],['ios','invalid',false]]){
    const r=invoke(platform,wait,contract);assert.notEqual(r.status,0);assert.doesNotMatch(r.output,/ARG:/,'reject before invoking EAS');
  }
  console.log('PASS — 7 workflow execution cases: detached legacy iOS, waiting defaults, contract/Android guards, invalid input and spaced archive path');
} finally {rmSync(dir,{recursive:true,force:true});}
