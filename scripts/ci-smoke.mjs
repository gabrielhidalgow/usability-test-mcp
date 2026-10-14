// Cross-platform install smoke test (used by the manual GitHub Actions check).
// Runs the update line from each generated slash command in the shell that host uses:
// bash for Claude Code (Git Bash on Windows), PowerShell for Codex on Windows.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { commandPath } from '../bin/install-lib.mjs';

const isWindows = process.platform === 'win32';
let failed = false;
for (const host of ['claude-code', 'codex']) {
  const text = readFileSync(commandPath(host), 'utf8');
  const line = host === 'claude-code' ? /!`([^`]+)`/.exec(text)?.[1] : /read its one-line result: `([^`]+)`/.exec(text)?.[1];
  if (!line) { console.log(`✗ ${host}: no update command in ${commandPath(host)}`); failed = true; continue; }
  const shell = host === 'codex' && isWindows ? ['pwsh', ['-NoProfile', '-Command', line]] : ['bash', ['-c', line]];
  const out = spawnSync(shell[0], shell[1], { encoding: 'utf8' });
  const result = `${out.stdout}${out.stderr}`.trim();
  const ok = out.status === 0 && /^(UP-TO-DATE|UPDATED|OFFLINE):/m.test(result);
  console.log(`${ok ? '✓' : '✗'} ${host} (${shell[0]}): ${line}\n    → ${result || `exit ${out.status}`}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
