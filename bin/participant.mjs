// Runs one synthetic participant as a separate headless host process with no project context:
// an empty working directory, only the usability MCP, and no file, web, agent or messaging tools.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const START_TOOLS = ['usability_run_project', 'usability_quick_test', 'usability_test_prototype', 'usability_run_native'];
// Built-in tools a participant must never have: they could reach project files, the web, other agents or chats.
export const CLAUDE_DENIED_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'Skill', 'SendMessage', 'ListAgents', 'ReadNotifications'];
export class ParticipantError extends Error { constructor(message, code = 1) { super(message); this.code = code; } }

const FIRST_VISIT = { mode: 'first-visit', isolation: 'host-reported fresh', exposure: [] };
/** Forces one participant and a clean first-visit declaration, leaving every other argument (and pinned ID) untouched. */
export function prepareStart(start) {
  if (!start || !START_TOOLS.includes(start.tool) || typeof start.arguments !== 'object') throw new ParticipantError(`--start must be {"tool": one of ${START_TOOLS.join(', ')}, "arguments": {...}}.`);
  const args = structuredClone(start.arguments);
  if (start.tool === 'usability_run_project') { args.participantCount = 1; args.options = { ...args.options, contextCheck: args.options?.contextCheck ?? FIRST_VISIT }; }
  else { if (start.tool !== 'usability_run_native') args.participantCount = 1; args.contextCheck = args.contextCheck ?? FIRST_VISIT; }
  const check = start.tool === 'usability_run_project' ? args.options.contextCheck : args.contextCheck;
  if (check.mode !== 'first-visit') throw new ParticipantError('The participant runner only runs clean first-visit tests. Run informed walkthroughs in the chat instead.');
  return { tool: start.tool, arguments: args };
}

/** Product names to probe for in the participant's context, derived from the target unless supplied. */
export async function productTerms(start, artifacts, extra = []) {
  const terms = new Set(extra.map(t => t.trim()).filter(Boolean));
  const fromUrl = value => { try { const host = new URL(value).hostname.replace(/^www\./, ''); terms.add(host); if (!/^[\d.]+$|^localhost$/.test(host)) terms.add(host.split('.')[0]); } catch { /* not a URL */ } };
  const a = start.arguments;
  if (a.target) fromUrl(a.target);
  if (a.appId) { terms.add(a.appId); terms.add(a.appId.split('.').at(-1)); }
  const readJson = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return undefined; } };
  if (a.prototypeId) { const p = await readJson(join(artifacts, 'prototypes', a.prototypeId, 'prototype.json')); if (p?.name) terms.add(p.name); }
  if (a.projectId) {
    const p = await readJson(join(artifacts, 'projects', `${a.projectId}.json`));
    if (p?.plan?.name) terms.add(p.plan.name);
    if (p?.plan?.target) { fromUrl(p.plan.target); if (p.plan.platform === 'prototype') { const proto = await readJson(join(artifacts, 'prototypes', p.plan.target, 'prototype.json')); if (proto?.name) terms.add(proto.name); } }
  }
  return [...terms].filter(t => t.length >= 3);
}
export function canaryPrompt(terms) {
  return `Answer from your instructions, memory, loaded files and tool descriptions only, not from general training knowledge, and do not call any tools. 1) Does any of that context mention any of these terms: ${terms.map(t => JSON.stringify(t)).join(', ') || '(none supplied)'}? 2) Do you have any project material in context, such as source code, repository files, design documents, brand or strategy notes, analytics, or earlier usability test results? Reply with only JSON: {"mentions": [...], "projectMaterial": [...]} using empty arrays when there is nothing.`;
}
export function parseCanary(reply) {
  const match = /\{[\s\S]*\}/.exec(reply ?? '');
  if (!match) return { passed: false, reason: 'The canary reply was not JSON, so isolation could not be confirmed.', reply };
  let parsed; try { parsed = JSON.parse(match[0]); } catch { return { passed: false, reason: 'The canary reply was not valid JSON.', reply }; }
  const mentions = Array.isArray(parsed.mentions) ? parsed.mentions.map(String) : null;
  const material = Array.isArray(parsed.projectMaterial) ? parsed.projectMaterial.map(String) : null;
  if (!mentions || !material) return { passed: false, reason: 'The canary reply did not have mentions and projectMaterial arrays.', reply };
  return { passed: !mentions.length && !material.length, mentions, projectMaterial: material };
}
export function participantPrompt(start) {
  return [
    'You are taking part in a usability test as a synthetic participant. You know nothing about the product. Use only the usability tools.',
    `1. Call ${start.tool} with exactly these arguments: ${JSON.stringify(start.arguments)}`,
    '2. The response gives "instructions" and a "participant" packet with a screenshot. Follow those instructions exactly; they are the rules of the test.',
    '3. Submit ONE decision at a time with usability_advance_session, always using the runId and the latest requestId from the previous response. In your first decision set "contextIsolation": "host-reported fresh" inside the decision object.',
    '4. Never fill in forms, sign up, log in, contact anyone, pay or submit anything.',
    '5. When the phase is "awaiting_findings", call usability_submit_findings with "findings": [] because evaluation happens elsewhere. If a call returns an error, read it, fix the arguments and retry with the latest requestId (usability_get_session_state gives it).',
    '6. Stop when the phase is "finished". End with one line of JSON: {"runId": "...", "status": "..."}',
  ].join('\n');
}

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
export async function acquireLock(artifacts, start) {
  const path = join(artifacts, 'active-run.json');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  try {
    const held = JSON.parse(await readFile(path, 'utf8'));
    if (held.pid && pidAlive(held.pid)) throw new ParticipantError(`Another participant is running (pid ${held.pid}, started ${held.startedAt}, ${held.tool}). Wait for it, or stop that process before starting another.`, 4);
    await unlink(path); // Stale lock from a process that no longer exists.
  } catch (error) { if (error instanceof ParticipantError) throw error; if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  try { await writeFile(path, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), tool: start.tool }) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new ParticipantError('Another participant started at the same moment. Try again shortly.', 4); throw error; }
  return async () => { try { const held = JSON.parse(await readFile(path, 'utf8')); if (held.pid === process.pid) await unlink(path); } catch { /* already gone */ } };
}

async function isolationDir(host, artifacts, serverPath) {
  const root = await mkdtemp(join(tmpdir(), 'usability-participant-'));
  const work = join(root, 'work'); await mkdir(work);
  const env = { USABILITY_ARTIFACT_DIR: artifacts, ...(['true', 'false'].includes(process.env.USABILITY_HEADLESS) ? { USABILITY_HEADLESS: process.env.USABILITY_HEADLESS } : {}) };
  const server = { command: process.execPath, args: [serverPath], env };
  if (host === 'claude') await writeFile(join(root, 'mcp.json'), JSON.stringify({ mcpServers: { usability: { type: 'stdio', ...server } } }), { mode: 0o600 });
  else {
    // A private CODEX_HOME holding only a link to the login: no other MCP servers, plugins, memories or AGENTS.md.
    const home = join(root, 'codex-home'); await mkdir(home, { mode: 0o700 });
    const auth = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
    if (existsSync(auth)) await symlink(auth, join(home, 'auth.json'));
    const toml = s => JSON.stringify(s);
    await writeFile(join(home, 'config.toml'), [`approval_policy = "never"`, `[mcp_servers.usability]`, `command = ${toml(server.command)}`, `args = [${server.args.map(toml).join(', ')}]`,
      `env = { ${Object.entries(env).map(([k, v]) => `${k} = ${toml(v)}`).join(', ')} }`, ''].join('\n'), { mode: 0o600 });
  }
  return { root, work };
}
export function hostInvocation(host, dir, prompt, hostBin) {
  if (host === 'claude') return { command: hostBin ?? 'claude', cwd: dir.work, env: process.env, args: ['-p', prompt, '--setting-sources', 'user', '--strict-mcp-config', '--mcp-config', join(dir.root, 'mcp.json'),
    '--allowedTools', 'mcp__usability__*', '--disallowedTools', ...CLAUDE_DENIED_TOOLS, '--no-session-persistence', '--output-format', 'json'] };
  return { command: hostBin ?? 'codex', cwd: dir.work, env: { ...process.env, CODEX_HOME: join(dir.root, 'codex-home') },
    args: ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-o', join(dir.root, 'last-message.txt'), prompt] };
}
function invoke(host, dir, prompt, { hostBin, timeoutMs }) {
  const call = hostInvocation(host, dir, prompt, hostBin);
  return new Promise(resolvePromise => {
    // stdin closed: codex exec otherwise waits for more input.
    const child = spawn(call.command, call.args, { cwd: call.cwd, env: call.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', error => { clearTimeout(timer); resolvePromise({ code: -1, stdout, stderr: String(error.message), timedOut: false }); });
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      let text = stdout;
      if (host === 'claude') { try { const out = JSON.parse(stdout); text = out.result ?? ''; if (out.is_error) code = code || 1; } catch { /* plain output */ } }
      else { try { text = await readFile(join(dir.root, 'last-message.txt'), 'utf8'); } catch { /* none */ } }
      resolvePromise({ code: code ?? 1, text, stdout, stderr, timedOut: signal === 'SIGTERM' });
    });
  });
}
const loginHint = host => host === 'claude' ? 'Run `claude /login` in a terminal (the headless CLI login is separate from the desktop app), then try again.' : 'Run `codex login` in a terminal, then try again.';

/** Preflight and canary only. Throws ParticipantError on failure. */
export async function checkIsolation({ host, artifacts, serverPath, hostBin, terms, timeoutMs = 180000 }) {
  const dir = await isolationDir(host, artifacts, serverPath);
  try {
    const ping = await invoke(host, dir, 'Reply with exactly: ok', { hostBin, timeoutMs });
    if (ping.code !== 0 || !/\bok\b/i.test(ping.text)) {
      const detail = `${ping.text} ${ping.stderr}`.trim().slice(0, 300);
      throw new ParticipantError(`The headless ${host} CLI could not answer${ping.timedOut ? ' in time' : ''}. ${/auth|login|oauth|credential|sign in|expired/i.test(detail) ? loginHint(host) : `Check that the ${host} CLI is installed and logged in. Detail: ${detail || 'none'}`}`, 2);
    }
    const canary = parseCanary((await invoke(host, dir, canaryPrompt(terms), { hostBin, timeoutMs })).text);
    if (!canary.passed) {
      const leaked = canary.reason ?? [...canary.mentions, ...canary.projectMaterial].join('; ');
      throw Object.assign(new ParticipantError(`Isolation check failed: the participant has project knowledge (${leaked}). Nothing was run. Options: remove that source (for example a user-level skill or global instructions mentioning the product) and retry, or run an informed walkthrough labelled as such.`, 3), { canary });
    }
    return { host, terms, canary };
  } finally { await rm(dir.root, { recursive: true, force: true }); }
}

const sessionsIn = async artifacts => { try { return new Set((await readdir(join(artifacts, 'sessions'))).filter(n => n.startsWith('session-'))); } catch { return new Set(); } };
export async function runParticipant({ host, start: rawStart, artifacts, serverPath = join(packageRoot, 'dist', 'src', 'index.js'), hostBin, extraTerms = [], timeoutMs = 20 * 60000, checkOnly = false }) {
  if (!['claude', 'codex'].includes(host)) throw new ParticipantError('Choose --host claude or --host codex.');
  const start = prepareStart(rawStart);
  const terms = await productTerms(start, artifacts, extraTerms);
  const release = await acquireLock(artifacts, start);
  try {
    const check = await checkIsolation({ host, artifacts, serverPath, hostBin, terms });
    if (checkOnly) return { ok: true, check: 'passed', host, terms };
    const before = await sessionsIn(artifacts);
    const startedAt = new Date().toISOString();
    const dir = await isolationDir(host, artifacts, serverPath);
    let result;
    try { result = await invoke(host, dir, participantPrompt(start), { hostBin, timeoutMs }); }
    finally { await rm(dir.root, { recursive: true, force: true }); }
    // Ground truth comes from disk, not from what the participant says it did.
    const created = [...await sessionsIn(artifacts)].filter(id => !before.has(id));
    if (created.length !== 1) throw new ParticipantError(`Expected one new session but found ${created.length}. ${result.timedOut ? 'The participant timed out.' : ''} Participant output: ${String(result.text).slice(-300)}`, 5);
    const runId = created[0];
    const dirOf = join(artifacts, 'sessions', runId);
    const session = JSON.parse(await readFile(join(dirOf, 'session.json'), 'utf8'));
    const reportExists = existsSync(join(dirOf, 'report.json'));
    const firstDecision = session.journey[0]?.decision?.contextIsolation;
    const record = { isolation: 'headless-process', host, startedAt, finishedAt: new Date().toISOString(),
      method: host === 'claude' ? 'claude -p from an empty temp directory with --setting-sources user, --strict-mcp-config (usability only) and file, web, agent, skill and messaging tools disallowed'
        : 'codex exec from an empty temp directory with a private CODEX_HOME holding only the login and the usability MCP, read-only sandbox',
      canary: { terms, passed: true }, firstDecisionContext: firstDecision ?? null, completed: Boolean(session.finishedAt) && reportExists };
    await writeFile(join(dirOf, 'participant-run.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    if (!record.completed) throw new ParticipantError(`The participant did not finish the run (${session.status}: ${session.reason}). Partial evidence is in ${dirOf}.`, 5);
    return { ok: true, runId, status: session.status, reason: session.reason, isolation: record.isolation, host, canary: check.canary.passed ? 'passed' : 'failed', artifacts: dirOf };
  } finally { await release(); }
}

export async function participantMain(flags) {
  const opts = {};
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === '--check') { opts.check = true; continue; }
    if (!['--host', '--start', '--artifacts', '--timeout-ms', '--terms', '--host-bin', '--server'].includes(flag) || flags[i + 1] === undefined) throw new ParticipantError('Usage: participant --host claude|codex --start \'{"tool":"usability_quick_test","arguments":{...}}\' [--check] [--terms "Name,domain"] [--artifacts DIR] [--timeout-ms N]');
    opts[flag] = flags[++i];
  }
  let start;
  try { start = JSON.parse(opts['--start'] ?? ''); } catch { throw new ParticipantError('--start must be JSON.'); }
  const artifacts = resolve(opts['--artifacts'] ?? process.env.USABILITY_ARTIFACT_DIR ?? join(homedir(), '.local', 'share', 'usability-mcp', 'artifacts'));
  return runParticipant({ host: opts['--host'], start, artifacts, hostBin: opts['--host-bin'], serverPath: opts['--server'] ? resolve(opts['--server']) : undefined,
    extraTerms: (opts['--terms'] ?? '').split(','), timeoutMs: opts['--timeout-ms'] ? Number(opts['--timeout-ms']) : undefined, checkOnly: Boolean(opts.check) });
}
