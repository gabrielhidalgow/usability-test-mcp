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
  config.mcpServers = { ...config.mcpServers, usability: entry };
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}
export async function main(args) {
  const [command, ...flags] = args;
  if (!command || command === '--help' || command === 'help') {
    console.log('Usability MCP\n  setup --host codex|claude|manual [--dir ABSOLUTE_PATH]\n  doctor\n  serve\n\nRequires Node 22+ and npm. Automated setup: macOS; Codex/manual also Linux.\nSetup installs a durable runtime and Chromium. Restart the host afterward.');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  if (command === 'serve' && !flags.length) { await import('../dist/src/index.js'); return; }
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
    if (!['--host', '--dir'].includes(flags[i]) || !flags[i + 1] || flags[i + 1].startsWith('--') || options[flags[i]]) throw new Error('Use setup --host codex|claude|manual [--dir PATH].');
    options[flags[i]] = flags[i + 1];
  }
  const host = options['--host'];
  if (!['codex', 'claude', 'manual'].includes(host)) throw new Error('Choose --host codex, claude, or manual.');
  if (!['darwin', 'linux'].includes(process.platform) || (host === 'claude' && process.platform !== 'darwin')) throw new Error('This installer supports macOS, and Codex/manual on Linux. See README for manual configuration on other systems.');
  if (host === 'codex') run('codex', ['--version']);
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
    const installed = join(runtime, 'node_modules', 'usability-mcp');
    const playwright = join(runtime, 'node_modules', 'playwright', 'cli.js');
    run(process.execPath, [playwright, 'install', 'chromium']);
    run(process.execPath, [join(installed, 'bin', 'usability-mcp.mjs'), 'doctor']);
    const entry = { command: process.execPath, args: [join(installed, 'dist', 'src', 'index.js')], env: { USABILITY_ARTIFACT_DIR: artifacts } };
    if (host === 'codex') run('codex', ['mcp', 'add', 'usability', '--env', `USABILITY_ARTIFACT_DIR=${artifacts}`, '--', entry.command, ...entry.args]);
    if (host === 'claude') await mergeClaudeConfig(join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), entry);
    if (host === 'manual') console.log(JSON.stringify({ mcpServers: { usability: entry } }, null, 2));
    console.log(`Installed. Reports and project profiles: ${artifacts}\n${host === 'manual' ? 'Add the configuration above to your MCP host.' : 'Registered usability with ' + host + '.'}\nRestart the host and enable the tools. Ask: “Set up a usability test for [URL].”\nNo model API keys required. Existing host tool permissions still apply.`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
