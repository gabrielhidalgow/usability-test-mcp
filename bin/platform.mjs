// Cross-platform process and path helpers (macOS, Linux, Windows).
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const isWindows = process.platform === 'win32';

/** Where installs live: ~/.local/share/usability-mcp, or %LOCALAPPDATA%\usability-mcp on Windows. */
export const defaultInstallDir = () => isWindows
  ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'usability-mcp')
  : join(homedir(), '.local', 'share', 'usability-mcp');

/** Claude Desktop's config file, where it has one. */
export function claudeDesktopConfigPath() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (isWindows) return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return undefined;
}

// npm's Windows wrappers (npm.cmd, npx.cmd and global shims such as claude.cmd or codex.cmd) end in a
// script under node_modules. Running that script with Node avoids cmd.exe, which mangles quotes and newlines.
export function shimScript(cmdPath, read = readFileSync) {
  let text;
  try { text = read(cmdPath, 'utf8'); } catch { return null; }
  // npm.cmd also names npm-prefix.js before npm-cli.js; the entry point is the *-cli.js script when there is one.
  const scripts = [...text.matchAll(/%~?dp0%?\\?(node_modules\\[^"\r\n]+?\.(?:c|m)?js)/gi)].map(m => m[1]);
  const script = scripts.find(s => /-cli\.(?:c|m)?js$/i.test(s)) ?? scripts.at(-1);
  return script ? resolve(dirname(cmdPath), script) : null;
}

function whereExe(command) {
  const found = spawnSync('where.exe', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = found.status === 0 ? found.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
  return lines.find(l => /\.exe$/i.test(l)) ?? lines.find(l => /\.(cmd|bat)$/i.test(l)) ?? lines[0];
}

/** Turns a command name or path into something spawn can start directly. */
export function resolveCommand(command, args = []) {
  if (/\.(c|m)?js$/i.test(command)) return { command: process.execPath, args: [command, ...args] };
  if (!isWindows) return { command, args };
  const path = /[\\/]/.test(command) ? command : whereExe(command);
  if (!path) return { command, args }; // spawn reports it as missing
  if (/\.(cmd|bat)$/i.test(path)) {
    const script = shimScript(path);
    if (script) return { command: process.execPath, args: [script, ...args] };
    // Last resort for wrappers we can't read: a shell, with each argument quoted.
    return { command: `"${path}"`, args: args.map(a => `"${String(a).replace(/"/g, '""')}"`), shell: true };
  }
  return { command: path, args };
}

export function spawnCommandSync(command, args, options = {}) {
  const r = resolveCommand(command, args);
  return spawnSync(r.command, r.args, { ...options, ...(r.shell ? { shell: true } : {}) });
}
export function spawnCommand(command, args, options = {}) {
  const r = resolveCommand(command, args);
  return spawn(r.command, r.args, { ...options, ...(r.shell ? { shell: true } : {}) });
}
