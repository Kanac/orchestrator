import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const workflow = readFileSync(new URL('../.github/workflows/run.yml', import.meta.url), 'utf8');
const body = name => workflow.split(`      - name: ${name}\n`)[1].split('      - name:')[0]
  .split('        run: |\n')[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
const validation = body('Validate ship platform');
const ship = body('Ship (play-replace)');
assert.match(workflow, /play_stage_only:\s+description:[^\n]+\s+required: false\s+default: false\s+type: boolean/u);
assert.match(ship, /args\+=\(--stage --notes-file store\/play-release-notes\.json\)/u);
assert.match(workflow.split('      - name: Ship (play-replace)\n')[1].split('      - name:')[0], /working-directory: src\/\$\{\{ inputs\.target \}\}/u);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const dir = mkdtempSync(join(tmpdir(), 'play-stage-only-'));
try {
  const invoke = (script, stageOnly, platform = 'android', mode = 'play-replace') => spawnSync(bash, ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PLAY_STAGE_ONLY: stageOnly, BUILD_PLATFORM: platform, SHIP_MODE: mode, RUNNER_TEMP: '/tmp/runner with spaces' },
  });
  let checked = 0;
  for (const [stage, platform, mode, accepted] of [
    ['true', 'android', 'play-replace', true],
    ['false', 'android', 'play-replace', true],
    ['false', 'android', 'eas', true],
    ['false', 'ios', 'asc-direct', true],
    ['true', 'android', 'eas', false],
    ['true', 'android', 'play-combined', false],
    ['true', 'ios', 'play-replace', false],
    ['true', 'ios', 'asc-direct', false],
    ['invalid', 'android', 'play-replace', false],
  ]) {
    const result = invoke(validation, stage, platform, mode);
    assert.equal(result.status === 0, accepted, result.stdout + result.stderr);
    checked += 1;
  }
  const mock = 'node() { printf "ARG:%s\\n" "$@"; };\n';
  const missingNotes = invoke(mock + ship, 'true');
  assert.notEqual(missingNotes.status, 0);
  assert.match(missingNotes.stdout, /requires store\/play-release-notes\.json/u);
  assert.doesNotMatch(missingNotes.stdout, /ARG:/u);
  checked += 1;
  const legacyWithoutNotes = invoke(mock + ship, 'false');
  assert.equal(legacyWithoutNotes.status, 0, legacyWithoutNotes.stdout + legacyWithoutNotes.stderr);
  assert.doesNotMatch(legacyWithoutNotes.stdout, /ARG:--(?:stage|notes-file)/u);
  checked += 1;
  mkdirSync(join(dir, 'store'));
  writeFileSync(join(dir, 'store', 'play-release-notes.json'), '[]');
  for (const stage of ['true', 'false']) {
    const result = invoke(mock + ship, stage);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /ARG:\/tmp\/runner with spaces\/out\.aab\nARG:production,internal\n/u);
    assert.equal(result.stdout.includes('ARG:--stage\n'), stage === 'true');
    assert.equal(result.stdout.includes('ARG:--notes-file\nARG:store/play-release-notes.json\n'), stage === 'true');
    assert.doesNotMatch(result.stdout, /ARG:--submit/u);
    checked += 1;
  }
  const invalid = invoke(mock + ship, 'invalid');
  assert.notEqual(invalid.status, 0);
  assert.doesNotMatch(invalid.stdout, /ARG:/u);
  checked += 1;
  console.log(`PASS — ${checked} workflow cases: stage intent, required app-root notes, legacy default, incompatible modes, invalid booleans and spaced AAB path`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
