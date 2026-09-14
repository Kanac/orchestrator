import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const workflow = readFileSync(new URL('../.github/workflows/run.yml', import.meta.url), 'utf8');
const step = workflow.split('      - name: Ship (play-combined)\n')[1].split('      - name:')[0];
assert.match(step, /inputs\.submit && inputs\.ship_mode == 'play-combined' && inputs\.platform == 'android'/);
assert.match(workflow, /play-combined:android/);
const run = step.split('        run: |\n')[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
const dir = mkdtempSync(join(tmpdir(), 'combined-play-submit-'));
try {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const shell = 'node() { if [ "$1" = -p ]; then printf "%s\\n" "$TEST_VERSION"; else printf "ARG:%s\\n" "$@"; fi; };\n' + run;
  for (const version of ['1.1.0', '2.0.0']) {
    const result = spawnSync(bash, ['-c', shell], { cwd: dir, encoding: 'utf8', env: { ...process.env, TEST_VERSION: version, RUNNER_TEMP: '/tmp/runner with spaces' } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /ARG:\/tmp\/runner with spaces\/out\.aab/);
    assert.match(result.stdout, /ARG:--with-listings\nARG:--name\n/);
    assert(result.stdout.includes(`ARG:${version}\nARG:--notes-file\nARG:--submit\n`));
    assert.equal(result.stdout.split('ARG:../scripts/play-replace-release.mjs').length - 1, 1);
  }
  for (const version of ['', 'undefined']) {
    const result = spawnSync(bash, ['-c', shell], { cwd: dir, encoding: 'utf8', env: { ...process.env, TEST_VERSION: version } });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /ARG:/);
  }
  console.log('PASS — 4 combined Play ship cases: exact version and spaced artifact path; missing version fails before submission');
} finally { rmSync(dir, { recursive: true, force: true }); }
