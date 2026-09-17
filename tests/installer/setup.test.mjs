import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeClaudeConfig, main } from '../../bin/usability-mcp.mjs';

test('Claude registration preserves settings and other servers, backs up, and updates idempotently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'usability config '));
  try {
    const path = join(dir, 'config.json');
    const original = { theme: 'dark', mcpServers: { other: { command: 'other' } } };
    await writeFile(path, JSON.stringify(original));
    const entry = { command: '/path with spaces/node', args: ['/path with spaces/index.js'] };
    await mergeClaudeConfig(path, entry);
    await mergeClaudeConfig(path, entry);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ...original, mcpServers: { ...original.mcpServers, usability: entry } });
    assert.equal((await readdir(dir)).filter(f => f.endsWith('.bak')).length, 2);
    await writeFile(path, '{invalid');
    await assert.rejects(mergeClaudeConfig(path, entry), /not changed/);
    assert.equal(await readFile(path, 'utf8'), '{invalid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('invalid setup options fail before installation', async () => {
  await assert.rejects(main(['setup']), /Choose/);
  await assert.rejects(main(['setup', '--host', 'unknown']), /Choose/);
  await assert.rejects(main(['setup', '--host', 'codex', '--bad', 'x']), /Use setup/);
});

test('npm-style executable symlink dispatches the CLI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'usability-bin-'));
  try {
    const link = join(dir, 'usability-mcp');
    await symlink(fileURLToPath(new URL('../../bin/usability-mcp.mjs', import.meta.url)), link);
    const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /setup --host/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
