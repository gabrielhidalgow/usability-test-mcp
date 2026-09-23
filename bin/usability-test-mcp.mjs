#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, copyFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed. Check that it is installed and inspect the output above.`);
  return result.stdout;
}
export async function mergeClaudeConfig(path, entry) {
  let config = {};
  let existing = false;
  try { config = JSON.parse(await readFile(path, 'utf8')); existing = true; }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Claude configuration is unreadable or invalid; it was not changed.'); }
  if (!config || Array.isArray(config) || typeof config !== 'object' || (config.mcpServers !== undefined && (!config.mcpServers || Array.isArray(config.mcpServers) || typeof config.mcpServers !== 'object'))) throw new Error('Unexpected Claude configuration; it was not changed.');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (existing) await copyFile(path, `${path}.${randomUUID()}.bak`);
  const previousHeadless = config.mcpServers?.usability?.env?.USABILITY_HEADLESS;
  if (entry.env?.USABILITY_HEADLESS === undefined && ['true','false'].includes(previousHeadless)) entry = { ...entry, env: { ...entry.env, USABILITY_HEADLESS: previousHeadless } };
  config.mcpServers = { ...config.mcpServers, usability: entry };
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}
export function claudeCodeArgs(entry) {
  return ['mcp', 'add-json', '--scope', 'user', 'usability', JSON.stringify({ type: 'stdio', ...entry })];
}
export async function registerClaudeCode(entry) {
  // Claude's CLI refuses duplicate names. Merge only our user entry when it
  // already exists, preserving other settings and a rollback copy.
  const configPath = process.env.CLAUDE_CONFIG_DIR
    ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
  let existing;
  try { existing = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Claude Code configuration could not be read; it was not changed.'); }
  if (existing?.mcpServers?.usability) await mergeClaudeConfig(configPath, { type: 'stdio', ...entry });
  else run('claude', claudeCodeArgs(entry));
}
export async function main(args) {
  const [command, ...flags] = args;
  if (!command || command === '--help' || command === 'help') {
    console.log('Usability Test MCP\n  setup --host codex|claude-code|claude-desktop|manual [--dir ABSOLUTE_PATH]\n  doctor [--native]\n  serve\n\nRequires Node 22+ and npm. Automated setup: macOS; Codex/Claude Code/manual also Linux.\nSetup installs a durable runtime and Chromium. Restart the host afterward.');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  if (command === 'serve' && !flags.length) { await import('../dist/src/index.js'); return; }
  if (command === 'doctor' && flags.length === 1 && flags[0] === '--native') {
    run('maestro', ['--version']);
    run('maestro', ['list-devices']);
    console.log('Native adapter is experimental. Use a prepared disposable emulator/simulator with the app installed. No network isolation, app reset, or native accessibility audit is provided.');
    return;
  }
  if (command === 'doctor' && !flags.length) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    console.log('OK: Node and Chromium work. Restart your host, then ask it to call usability_health to verify the MCP connection.');
    return;
  }
  if (command !== 'setup') throw new Error('Unknown command. Run with --help.');
  const options = {};
  for (let i = 0; i < flags.length; i += 2) {
    if (!['--host', '--dir'].includes(flags[i]) || !flags[i + 1] || flags[i + 1].startsWith('--') || options[flags[i]]) throw new Error('Use setup --host codex|claude-code|claude-desktop|manual [--dir PATH].');
    options[flags[i]] = flags[i + 1];
  }
  const host = options['--host'] === 'claude' ? 'claude-desktop' : options['--host'];
  if (!['codex', 'claude-code', 'claude-desktop', 'manual'].includes(host)) throw new Error('Choose --host codex, claude-code, claude-desktop, or manual.');
  if (!['darwin', 'linux'].includes(process.platform) || (host === 'claude-desktop' && process.platform !== 'darwin')) throw new Error('This installer supports macOS, and Codex/manual on Linux. See README for manual configuration on other systems.');
  if (host === 'codex') run('codex', ['--version']);
  if (host === 'claude-code') run('claude', ['--version']);
  run('npm', ['--version']);
  const destination = resolve(options['--dir'] || join(homedir(), '.local', 'share', 'usability-mcp'));
  const runtime = join(destination, 'runtime');
  const artifacts = join(destination, 'artifacts');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(tmpdir(), 'usability-install-'));
  try {
    console.log('Installing a durable copy of this package…');
    const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
    await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, name: 'usability-local-runtime', version: '1.0.0' }) + '\n');
    run('npm', ['install', '--prefix', runtime, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(temp, packed[0].filename)]);
    const installed = join(runtime, 'node_modules', 'usability-test-mcp');
    const playwright = join(runtime, 'node_modules', 'playwright', 'cli.js');
    run(process.execPath, [playwright, 'install', 'chromium']);
    run(process.execPath, [join(installed, 'bin', 'usability-test-mcp.mjs'), 'doctor']);
    const entry = { command: process.execPath, args: [join(installed, 'dist', 'src', 'index.js')], env: { USABILITY_ARTIFACT_DIR: artifacts, ...(['true','false'].includes(process.env.USABILITY_HEADLESS) ? { USABILITY_HEADLESS: process.env.USABILITY_HEADLESS } : {}) } };
    if (host === 'codex') {
      const previous = spawnSync('codex', ['mcp', 'get', 'usability', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (previous.status === 0 && entry.env.USABILITY_HEADLESS === undefined) {
        try { const saved = JSON.parse(previous.stdout); const value = saved.transport?.env?.USABILITY_HEADLESS; if (['true','false'].includes(value)) entry.env.USABILITY_HEADLESS = value; } catch { throw new Error('Existing Codex entry could not be read; registration was not changed.'); }
      }
      run('codex', ['mcp', 'add', 'usability', ...Object.entries(entry.env).flatMap(([key,value]) => ['--env', `${key}=${value}`]), '--', entry.command, ...entry.args]);
    }
    if (host === 'claude-code') await registerClaudeCode(entry);
    if (host === 'claude-desktop') await mergeClaudeConfig(join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), entry);
    if (host === 'manual') console.log(JSON.stringify({ mcpServers: { usability: entry } }, null, 2));
    console.log(`Installed. Reports and project profiles: ${artifacts}\n${host === 'manual' ? 'Add the configuration above to your MCP host.' : 'Registered usability with ' + host + '.'}\nRestart the host and enable the tools. Ask: “Set up a usability test for [URL].”\nNo model API keys required. Existing host tool permissions still apply.`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
