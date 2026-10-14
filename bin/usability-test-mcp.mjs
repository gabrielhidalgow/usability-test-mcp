#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, copyFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { claudeDesktopConfigPath, defaultInstallDir, isWindows, spawnCommandSync } from './platform.mjs';
import { COMMAND_HOSTS, cliCommand, commandPath, pkg, readState, removeCommand, renderCommand, sourceCommit, latestCommit, writeCommand, writeState } from './install-lib.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, options = {}) {
  const result = spawnCommandSync(command, args, { stdio: 'inherit', ...options });
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
const HOSTS = ['claude-code', 'codex', 'claude-desktop', 'manual'];
const HELP = `Usability Test MCP ${pkg.version}

  setup --host claude-code|codex|claude-desktop|manual[,…] [--dir PATH]   install, register and add /usability-test
  update [--dir PATH]                                                      install the latest version if there is one
  doctor [--dir PATH] [--native]                                           check everything works, with fixes
  uninstall [--host …] [--dir PATH]                                        remove registrations and commands (keeps reports)
  participant --host claude|codex --start JSON [--check]                   run one isolated participant
  serve                                                                    start the MCP server (hosts do this)

Requires Node 22+ and npm. Automated setup: macOS, Linux and Windows (experimental).`;
function parseFlags(flags, allowed, usage) {
  const options = {};
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--native' || flags[i] === '--browser-only') { options[flags[i]] = true; continue; }
    if (!allowed.includes(flags[i]) || !flags[i + 1] || flags[i + 1].startsWith('--') || options[flags[i]]) throw new Error(usage);
    options[flags[i]] = flags[++i];
  }
  return options;
}
const defaultDir = defaultInstallDir;
function parseHosts(value) {
  const hosts = [...new Set(String(value ?? '').split(',').map(h => h.trim()).filter(Boolean).map(h => h === 'claude' ? 'claude-desktop' : h))];
  if (!hosts.length || hosts.some(h => !HOSTS.includes(h))) throw new Error('Choose --host claude-code, codex, claude-desktop or manual (comma-separate several).');
  return hosts;
}
export async function main(args) {
  const [command, ...flags] = args;
  if (!command || command === '--help' || command === 'help') { console.log(HELP); return; }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  if (command === 'serve' && !flags.length) { await import('../dist/src/index.js'); return; }
  if (command === 'participant') {
    const { participantMain, ParticipantError } = await import('./participant.mjs');
    try { console.log(JSON.stringify(await participantMain(flags), null, 2)); }
    catch (error) { if (error instanceof ParticipantError) { console.log(JSON.stringify({ ok: false, code: error.code, error: error.message }, null, 2)); process.exitCode = error.code; return; } throw error; }
    return;
  }
  if (command === 'doctor') return doctor(parseFlags(flags, ['--dir'], 'Use doctor [--dir PATH] [--native].'));
  if (command === 'update') return update(parseFlags(flags, ['--dir'], 'Use update [--dir PATH].'));
  if (command === 'uninstall') return uninstall(parseFlags(flags, ['--dir', '--host'], 'Use uninstall [--host …] [--dir PATH].'));
  if (command !== 'setup') throw new Error('Unknown command. Run with --help.');
  const options = parseFlags(flags, ['--host', '--dir', '--commit'], 'Use setup --host codex|claude-code|claude-desktop|manual [--dir PATH].');
  const hosts = parseHosts(options['--host']);
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('This installer supports macOS, Linux and Windows. See docs/INSTALL.md for other systems.');
  if (hosts.includes('claude-desktop') && !claudeDesktopConfigPath()) throw new Error('Claude Desktop setup is available on macOS and Windows. Use --host claude-code or codex here.');
  if (hosts.includes('codex')) run('codex', ['--version']);
  if (hosts.includes('claude-code')) run('claude', ['--version']);
  run('npm', ['--version']);
  const destination = resolve(options['--dir'] || defaultDir());
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
    run(process.execPath, [join(installed, 'bin', 'usability-test-mcp.mjs'), 'doctor', '--browser-only']);
    const entry = { command: process.execPath, args: [join(installed, 'dist', 'src', 'index.js')], env: { USABILITY_ARTIFACT_DIR: artifacts, ...(['true','false'].includes(process.env.USABILITY_HEADLESS) ? { USABILITY_HEADLESS: process.env.USABILITY_HEADLESS } : {}) } };
    const bin = join(installed, 'bin', 'usability-test-mcp.mjs');
    const cli = cliCommand(bin);
    const lines = [];
    for (const host of hosts) {
      if (host === 'codex') {
        const previous = spawnCommandSync('codex', ['mcp', 'get', 'usability', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        if (previous.status === 0 && entry.env.USABILITY_HEADLESS === undefined) {
          try { const saved = JSON.parse(previous.stdout); const value = saved.transport?.env?.USABILITY_HEADLESS; if (['true','false'].includes(value)) entry.env.USABILITY_HEADLESS = value; } catch { throw new Error('Existing Codex entry could not be read; registration was not changed.'); }
        }
        run('codex', ['mcp', 'add', 'usability', ...Object.entries(entry.env).flatMap(([key,value]) => ['--env', `${key}=${value}`]), '--', entry.command, ...entry.args]);
      }
      if (host === 'claude-code') await registerClaudeCode(entry);
      if (host === 'claude-desktop') await mergeClaudeConfig(claudeDesktopConfigPath(), entry);
      if (host === 'manual') console.log(JSON.stringify({ mcpServers: { usability: entry } }, null, 2));
      if (COMMAND_HOSTS[host]) {
        const flavor = isWindows && host === 'codex' ? 'powershell' : 'posix';
        const result = await writeCommand(commandPath(host), await renderCommand(host, { cli: cliCommand(bin, flavor), dir: destination, flavor }));
        lines.push(result.status === 'kept-yours'
          ? `${COMMAND_HOSTS[host].name}: your edited ${result.path} was kept; the new version is ${result.newPath}.`
          : `${COMMAND_HOSTS[host].name}: restart it, then type  ${COMMAND_HOSTS[host].invoke} https://your-site.com`);
      } else lines.push(host === 'manual' ? 'Manual: add the configuration above to your MCP host.' : 'Claude Desktop: restart it and ask "Set up a usability test for https://your-site.com".');
    }
    await writeState(destination, { version: pkg.version, commit: sourceCommit(options['--commit']), hosts, installedAt: new Date().toISOString(), cli });
    console.log(`\nDone. Usability Test MCP ${pkg.version} is installed.\n\n${lines.map(l => '  ' + l).join('\n')}\n\nReports stay on this computer in ${artifacts}. No model API keys are needed.\nCheck everything any time with:  ${cli} doctor`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function update(options) {
  const dir = resolve(options['--dir'] || defaultDir());
  const state = await readState(dir);
  if (!state) { console.log(`NOT-INSTALLED: run setup first (no install found in ${dir}).`); return; }
  const latest = process.env.USABILITY_TEST_LATEST || latestCommit();
  if (!latest) { console.log('OFFLINE: could not check GitHub; using the installed version.'); return; }
  if (latest === state.commit) { console.log(`UP-TO-DATE: ${latest.slice(0, 7)}`); return; }
  // Tests override the installer with a JSON array (paths may contain spaces).
  const installer = process.env.USABILITY_TEST_SETUP_CMD
    ? JSON.parse(process.env.USABILITY_TEST_SETUP_CMD)
    : ['npx', '--yes', `github:gabrielhidalgow/usability-test-mcp#${latest}`];
  const result = spawnCommandSync(installer[0], [...installer.slice(1), 'setup', '--host', state.hosts.join(','), '--dir', dir, '--commit', latest], { stdio: 'ignore', timeout: 600000 });
  if (result.status !== 0) { console.log(`UPDATE-FAILED: could not install ${latest.slice(0, 7)}; using the installed version. Run setup manually to see the error.`); return; }
  console.log(`UPDATED: ${(state.commit ?? 'unknown').slice(0, 7)} -> ${latest.slice(0, 7)}. Restart your chat app (or reconnect the usability MCP) to use the new version.`);
}

async function doctor(options) {
  if (options['--native']) {
    run('maestro', ['--version']); run('maestro', ['list-devices']);
    console.log('Native adapter is experimental. Use a prepared disposable emulator/simulator with the app installed. No network isolation, app reset, or native accessibility audit is provided.');
    return;
  }
  const checks = [];
  const check = (ok, label, fix) => checks.push({ ok, label, fix });
  check(Number(process.versions.node.split('.')[0]) >= 22, `Node ${process.versions.node}`, 'Install Node.js 22 or newer.');
  try { const { chromium } = await import('playwright'); const browser = await chromium.launch({ headless: true }); await browser.close(); check(true, 'Chromium launches'); }
  catch { check(false, 'Chromium launches', 'Rerun setup, or on Linux install the Chromium system libraries (npx playwright install --with-deps chromium).'); }
  if (options['--browser-only']) { console.log(checks.map(c => `${c.ok ? '✓' : '✗'} ${c.label}`).join('\n')); if (checks.some(c => !c.ok)) throw new Error('Chromium could not start.'); return; } // used by setup
  const dir = resolve(options['--dir'] || defaultDir());
  const state = await readState(dir);
  check(Boolean(state), state ? `Installed v${state.version} for ${state.hosts.join(', ')}` : 'Installed', 'Run: npx --yes github:gabrielhidalgow/usability-test-mcp setup --host claude-code (or codex)');
  for (const host of state?.hosts ?? []) {
    if (host === 'claude-code' || host === 'codex') {
      const bin = host === 'codex' ? 'codex' : 'claude';
      const registered = spawnCommandSync(bin, ['mcp', 'get', 'usability'], { stdio: 'ignore' }).status === 0;
      check(registered, `${COMMAND_HOSTS[host].name}: usability MCP registered`, 'Rerun setup for this host.');
      let command = '';
      try { command = await readFile(commandPath(host), 'utf8'); } catch { /* missing */ }
      check(Boolean(command), `${COMMAND_HOSTS[host].name}: ${COMMAND_HOSTS[host].invoke} installed`, 'Rerun setup for this host.');
      // Probe with a made-up product: any mention means context leaks into participants.
      const { checkIsolation } = await import('./participant.mjs');
      try { await checkIsolation({ host: COMMAND_HOSTS[host].runner, artifacts: join(dir, 'artifacts'), serverPath: join(packageRoot, 'dist', 'src', 'index.js'), terms: ['Quillfern Analytics', 'quillfern-analytics.test'] }); check(true, `${COMMAND_HOSTS[host].name}: clean participants can run (login and isolation check)`); }
      catch (error) { check(false, `${COMMAND_HOSTS[host].name}: clean participants can run`, error.message); }
    }
  }
  console.log(checks.map(c => `${c.ok ? '✓' : '✗'} ${c.label}${c.ok || !c.fix ? '' : `\n    → ${c.fix}`}`).join('\n'));
  console.log('\nFigma tests: connect the official Figma MCP in your chat app (no token), or export frames as PNG.');
  if (checks.some(c => !c.ok)) process.exitCode = 1;
}

async function uninstall(options) {
  const dir = resolve(options['--dir'] || defaultDir());
  const state = await readState(dir);
  const hosts = options['--host'] ? parseHosts(options['--host']) : state?.hosts ?? [];
  if (!hosts.length) { console.log('Nothing to uninstall (no install found). Pass --host to remove a registration anyway.'); return; }
  for (const host of hosts) {
    if (host === 'claude-code') spawnCommandSync('claude', ['mcp', 'remove', '--scope', 'user', 'usability'], { stdio: 'ignore' });
    if (host === 'codex') spawnCommandSync('codex', ['mcp', 'remove', 'usability'], { stdio: 'ignore' });
    if (COMMAND_HOSTS[host]) {
      const removed = await removeCommand(commandPath(host));
      console.log(`${COMMAND_HOSTS[host].name}: MCP removed; command ${removed === 'kept-yours' ? 'kept because you edited it' : removed}.`);
    }
  }
  await rm(join(dir, 'runtime'), { recursive: true, force: true });
  await rm(join(dir, 'install.json'), { force: true });
  console.log(`Removed the runtime. Your reports and projects are still in ${join(dir, 'artifacts')}; delete that folder to remove them.`);
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
