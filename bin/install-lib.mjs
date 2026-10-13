// Install helpers shared by setup, update, doctor and uninstall.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
export const REPO_URL = 'https://github.com/gabrielhidalgow/usability-test-mcp';
export const COMMAND_HOSTS = {
  'claude-code': { runner: 'claude', name: 'Claude Code', login: 'claude /login', invoke: '/usability-test' },
  codex: { runner: 'codex', name: 'Codex', login: 'codex login', invoke: '/prompts:usability-test' },
};

export function commandPath(host) {
  if (host === 'claude-code') return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'commands', 'usability-test.md');
  if (host === 'codex') return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'prompts', 'usability-test.md');
  return undefined;
}
const quote = value => (/^[\w./:@-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`);
/** The CLI of the installed copy, as a shell command prefix. */
export const cliCommand = installedBin => `${quote(process.execPath)} ${quote(installedBin)}`;

const MARKER = /\n<!-- usability-test-mcp generated v([\w.-]+) sha256:([0-9a-f]{64}) -->\n?$/;
const hash = text => createHash('sha256').update(text).digest('hex');
/** Fills the command template for one host. Conditional blocks: {{#claude}}…{{/claude}}, {{#codex}}…{{/codex}}. */
export async function renderCommand(host, { cli, dir }) {
  const meta = COMMAND_HOSTS[host];
  let text = await readFile(join(packageRoot, 'assets', 'usability-test.command.md'), 'utf8');
  for (const block of ['claude', 'codex']) {
    const keep = (block === 'claude') === (host === 'claude-code');
    text = text.replace(new RegExp(`\\{\\{#${block}\\}\\}([\\s\\S]*?)\\{\\{/${block}\\}\\}`, 'g'), keep ? '$1' : '');
  }
  const values = { UPDATE: `${cli} update --dir ${quote(dir)}`, CLI: cli, RUNNER_HOST: meta.runner, LOGIN: meta.login, HOST_NAME: meta.name };
  text = text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
  return `${text}\n<!-- usability-test-mcp generated v${pkg.version} sha256:${hash(text)} -->\n`;
}
/** Generated means the file still carries our marker and its body is unchanged since we wrote it. */
export function isUnmodifiedGenerated(text) {
  const match = MARKER.exec(text);
  return Boolean(match && hash(text.slice(0, match.index)) === match[2]);
}
/** Never overwrites a command the user wrote or edited: a fresh copy goes beside it as .new. */
export async function writeCommand(path, content) {
  let current;
  try { current = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current === content) return { status: 'unchanged', path };
  await mkdir(dirname(path), { recursive: true });
  if (current !== undefined && !isUnmodifiedGenerated(current)) {
    await writeFile(`${path}.new`, content);
    return { status: 'kept-yours', path, newPath: `${path}.new` };
  }
  const temp = `${path}.tmp`; await writeFile(temp, content); await rename(temp, path);
  return { status: current === undefined ? 'installed' : 'updated', path };
}
export async function removeCommand(path) {
  let current;
  try { current = await readFile(path, 'utf8'); } catch { return 'absent'; }
  if (!isUnmodifiedGenerated(current)) return 'kept-yours';
  await rm(path); await rm(`${path}.new`, { force: true });
  return 'removed';
}

/** The commit this package came from, when it can be known (git checkout, npm git install, or passed by update). */
export function sourceCommit(explicit) {
  if (explicit) return explicit;
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (git.status === 0 && /^[0-9a-f]{40}$/.test(git.stdout.trim()) && existsSync(join(packageRoot, '.git'))) return git.stdout.trim();
  return commitFromLockfiles(packageRoot) ?? (/^[0-9a-f]{40}$/.test(pkg.gitHead ?? '') ? pkg.gitHead : null);
}
/** `npx github:…` installs into <dir>/node_modules/<name>; npm records the resolved commit in that dir's lockfiles. */
export function commitFromLockfiles(root) {
  for (const lock of [join(root, '..', '.package-lock.json'), join(root, '..', '..', 'package-lock.json')]) {
    try {
      const resolved = JSON.parse(readFileSync(lock, 'utf8')).packages?.[`node_modules/${pkg.name}`]?.resolved ?? '';
      const sha = /#([0-9a-f]{40})$/.exec(resolved)?.[1];
      if (sha) return sha;
    } catch { /* not installed by npm from git */ }
  }
  return null;
}
export const statePath = dir => join(dir, 'install.json');
export async function readState(dir) {
  try { return JSON.parse(await readFile(statePath(dir), 'utf8')); } catch { return null; }
}
export async function writeState(dir, state) {
  await writeFile(statePath(dir), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  // Older update scripts read this file.
  if (state.commit) await writeFile(join(dir, 'installed-commit'), state.commit + '\n');
}
export function latestCommit(lsRemote = () => spawnSync('git', ['ls-remote', REPO_URL, 'HEAD'], { encoding: 'utf8', timeout: 20000 })) {
  const out = lsRemote();
  const sha = out.status === 0 ? out.stdout.slice(0, 40) : '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}
