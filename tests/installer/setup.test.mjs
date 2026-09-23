import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeClaudeConfig, main } from '../../bin/usability-test-mcp.mjs';

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
    const link = join(dir, 'usability-test-mcp');
    await symlink(fileURLToPath(new URL('../../bin/usability-test-mcp.mjs', import.meta.url)), link);
    const result = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /setup --host/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Claude Code registration uses user scope, preserves existing settings and can update', async () => {
  const { claudeCodeArgs, registerClaudeCode } = await import('../../bin/usability-test-mcp.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'usability-claude-code-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const entry={command:'/node with spaces',args:['/server with spaces/index.js'],env:{USABILITY_ARTIFACT_DIR:'/reports'}};
    assert.deepEqual(claudeCodeArgs(entry).slice(0,5),['mcp','add-json','--scope','user','usability']);
    const path=join(dir,'.claude.json');
    await writeFile(path,JSON.stringify({theme:'dark',mcpServers:{other:{command:'other'},usability:{command:'old'}}}));
    await registerClaudeCode(entry);
    const saved=JSON.parse(await readFile(path,'utf8'));
    assert.equal(saved.theme,'dark');assert.equal(saved.mcpServers.other.command,'other');
    assert.equal(saved.mcpServers.usability.command,entry.command);
    assert.equal(saved.mcpServers.usability.type,'stdio');
  } finally { if(previous===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=previous;await rm(dir,{recursive:true,force:true}); }
});
