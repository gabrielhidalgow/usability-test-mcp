import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderCommand, writeCommand, removeCommand, isUnmodifiedGenerated, commandPath, writeState } from '../../bin/install-lib.mjs';
import { main } from '../../bin/usability-test-mcp.mjs';

const cli = '/usr/bin/node /opt/usability/bin/usability-test-mcp.mjs';
test('the slash command is generated for Claude Code and Codex from one template', async () => {
  const claude = await renderCommand('claude-code', { cli, dir: '/opt/usability' });
  const codex = await renderCommand('codex', { cli, dir: '/opt/usability' });
  assert.match(claude, /^---\ndescription: /, 'front matter stays first');
  assert.match(claude, /allowed-tools: Bash\(\/usr\/bin\/node \/opt\/usability\/bin\/usability-test-mcp\.mjs update --dir \/opt\/usability\)/);
  assert.match(claude, /!`\/usr\/bin\/node .* update --dir \/opt\/usability`/);
  assert.match(claude, /participant --host claude/); assert.match(claude, /claude \/login/);
  assert.match(codex, /First run this shell command/); assert.match(codex, /participant --host codex/); assert.match(codex, /codex login/);
  assert.doesNotMatch(codex, /allowed-tools|!`/);
  for (const text of [claude, codex]) { assert.doesNotMatch(text, /\{\{/); assert(isUnmodifiedGenerated(text)); assert.match(text, /\$ARGUMENTS/); }
  const dir = await mkdtemp(join(tmpdir(), 'cmd-paths-'));
  const saved = { c: process.env.CLAUDE_CONFIG_DIR, x: process.env.CODEX_HOME };
  process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude'); process.env.CODEX_HOME = join(dir, 'codex');
  try {
    assert.equal(commandPath('claude-code'), join(dir, 'claude', 'commands', 'usability-test.md'));
    assert.equal(commandPath('codex'), join(dir, 'codex', 'prompts', 'usability-test.md'));
  } finally { if (saved.c === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved.c; if (saved.x === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved.x; await rm(dir, { recursive: true, force: true }); }
});

test('installing never overwrites a command the user edited; uninstall keeps edits too', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cmd-write-'));
  try {
    const path = join(dir, 'commands', 'usability-test.md');
    const v1 = await renderCommand('claude-code', { cli, dir: '/opt/a' }), v2 = await renderCommand('claude-code', { cli, dir: '/opt/b' });
    assert.equal((await writeCommand(path, v1)).status, 'installed');
    assert.equal((await writeCommand(path, v1)).status, 'unchanged');
    assert.equal((await writeCommand(path, v2)).status, 'updated', 'our own unedited file is updated');
    await writeFile(path, (await readFile(path, 'utf8')).replace('Default to one desktop participant', 'Default to three participants'));
    const kept = await writeCommand(path, v1);
    assert.equal(kept.status, 'kept-yours'); assert.match(await readFile(kept.newPath, 'utf8'), /Default to one desktop/);
    assert.match(await readFile(path, 'utf8'), /three participants/);
    assert.equal(await removeCommand(path), 'kept-yours');
    await writeFile(path, '# my own command\n');
    assert.equal((await writeCommand(path, v1)).status, 'kept-yours', 'a hand-written command without our marker is kept');
    await writeFile(path, v2); assert.equal(await removeCommand(path), 'removed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('update reinstalls the recorded hosts only when GitHub has a newer commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'update-'));
  const record = join(dir, 'setup-args.txt');
  await writeFile(join(dir, 'fake-setup.mjs'), `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(record)}, process.argv.slice(2).join(' ') + '\\n');`);
  const logs = []; const log = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    await main(['update', '--dir', dir]);
    assert.match(logs.pop(), /NOT-INSTALLED/);
    await writeState(dir, { version: '0.12.2', commit: 'a'.repeat(40), hosts: ['claude-code', 'codex'], installedAt: '' });
    assert.equal((await readFile(join(dir, 'installed-commit'), 'utf8')).trim(), 'a'.repeat(40), 'legacy marker kept for older update scripts');
    process.env.USABILITY_TEST_LATEST = 'a'.repeat(40);
    await main(['update', '--dir', dir]); assert.match(logs.pop(), /UP-TO-DATE: aaaaaaa/);
    process.env.USABILITY_TEST_LATEST = 'b'.repeat(40); process.env.USABILITY_TEST_SETUP_CMD = `${process.execPath} ${join(dir, 'fake-setup.mjs')}`;
    await main(['update', '--dir', dir]); assert.match(logs.pop(), /UPDATED: aaaaaaa -> bbbbbbb/);
    assert.equal((await readFile(record, 'utf8')).trim(), `setup --host claude-code,codex --dir ${dir} --commit ${'b'.repeat(40)}`);
  } finally { console.log = log; delete process.env.USABILITY_TEST_LATEST; delete process.env.USABILITY_TEST_SETUP_CMD; await rm(dir, { recursive: true, force: true }); }
});
