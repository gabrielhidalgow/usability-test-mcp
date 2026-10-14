import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWindows, resolveCommand, shimScript, spawnCommandSync } from '../../bin/platform.mjs';
import { cliCommand, shellQuote } from '../../bin/install-lib.mjs';
import { participantMain, ParticipantError } from '../../bin/participant.mjs';

// The tail of the wrapper npm writes for a global package on Windows (cmd-shim).
const GLOBAL_SHIM = (script) => `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*\r\n`;
// npm 10's npm.cmd names npm-prefix.js first, then npm-cli.js.
const NPM_CMD = ':: Created by npm\r\n@ECHO OFF\r\nSETLOCAL\r\nSET "NODE_EXE=%~dp0\\node.exe"\r\nSET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\r\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\nFOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js")\r\n"%NODE_EXE%" "%NPM_CLI_JS%" %*\r\n';

test('Windows npm wrappers are read to find the real script, so no shell is needed', () => {
  const read = text => () => text;
  assert.match(shimScript('C:\\npm\\claude.cmd', read(GLOBAL_SHIM('node_modules\\@anthropic-ai\\claude-code\\cli.js'))), /claude-code[\\/]+cli\.js$|claude-code\\cli\.js$/);
  assert.match(shimScript('C:\\nodejs\\npm.cmd', read(NPM_CMD)), /npm-cli\.js$/);
  assert.equal(shimScript('C:\\x\\other.cmd', read('@echo off\r\nsomething.exe %*\r\n')), null);
  const js = resolveCommand('/tmp/fake-host.mjs', ['-p', 'x']);
  assert.equal(js.command, process.execPath, 'scripts run with Node on every platform');
  assert.deepEqual(js.args, ['/tmp/fake-host.mjs', '-p', 'x']);
});

test('generated commands quote paths for bash and for PowerShell', () => {
  assert.equal(shellQuote('/plain/path.mjs'), '/plain/path.mjs');
  assert.equal(shellQuote('/a b/$x'), '"/a b/\\$x"');
  assert.equal(shellQuote("/it's here", 'powershell'), "'/it''s here'");
  assert.match(cliCommand('/a b/x.mjs', 'powershell'), /^& \S+ '\/a b\/x\.mjs'$/);
});

test('--start @file reads the start JSON from a file', async () => {
  await assert.rejects(participantMain(['--host', 'claude', '--start', '@/no/such/file.json']), e => e instanceof ParticipantError && /Could not read/.test(e.message));
  const dir = await mkdtemp(join(tmpdir(), 'start-'));
  try {
    await writeFile(join(dir, 'start.json'), '{"tool":"not_a_tool","arguments":{}}');
    await assert.rejects(participantMain(['--host', 'claude', '--start', `@${join(dir, 'start.json')}`]), e => e instanceof ParticipantError && /--start must be/.test(e.message));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Windows: an npm-style .cmd wrapper runs with arguments intact (spaces, quotes, JSON, newlines)', { skip: !isWindows }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shim-'));
  try {
    await mkdir(join(dir, 'node_modules', 'fake-cli'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'fake-cli', 'cli.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    await writeFile(join(dir, 'fake-cli.cmd'), GLOBAL_SHIM('node_modules\\fake-cli\\cli.js'));
    const args = ['-p', 'two words', '{"tool":"usability_quick_test","arguments":{"goal":"Find \\"price\\""}}', 'line one\nline two'];
    const out = spawnCommandSync(join(dir, 'fake-cli.cmd'), args, { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), args);
    const npm = spawnCommandSync('npm', ['--version'], { encoding: 'utf8' });
    assert.equal(npm.status, 0, 'npm.cmd starts without a shell');
    assert.match(npm.stdout.trim(), /^\d+\.\d+\.\d+$/, 'and runs npm itself, not its prefix helper');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
