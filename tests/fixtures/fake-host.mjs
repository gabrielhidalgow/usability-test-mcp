#!/usr/bin/env node
// Test double for `claude -p` / `codex exec`: NOT a model. Answers preflight and canary from env flags,
// and drives a participant session through the MCP server named in its isolated config.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const args = process.argv.slice(2);
const codex = args[0] === 'exec';
const prompt = codex ? args.at(-1) : args[args.indexOf('-p') + 1];
if (process.env.FAKE_HOST_LOG) appendFileSync(process.env.FAKE_HOST_LOG, JSON.stringify({ args, cwd: process.cwd(), codexHome: process.env.CODEX_HOME ?? null }) + '\n');
const reply = text => {
  if (codex) writeFileSync(args[args.indexOf('-o') + 1], text);
  else process.stdout.write(JSON.stringify({ result: text, is_error: false }));
};
if (process.env.FAKE_HOST_FAIL === 'auth') { process.stderr.write('Failed to authenticate: OAuth session expired'); process.exit(1); }
if (prompt === 'Reply with exactly: ok') { reply('ok'); process.exit(0); }
if (prompt.includes('projectMaterial')) {
  reply(process.env.FAKE_HOST_LEAK ? JSON.stringify({ mentions: [process.env.FAKE_HOST_LEAK], projectMaterial: ['CLAUDE.md project notes'] }) : '{"mentions": [], "projectMaterial": []}');
  process.exit(0);
}
let server;
if (codex) {
  const toml = readFileSync(join(process.env.CODEX_HOME, 'config.toml'), 'utf8');
  const servers = [...toml.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)].map(m => m[1]);
  if (servers.join() !== 'usability') throw new Error(`Unexpected MCP servers: ${servers}`);
  server = { command: JSON.parse(/^command = (.*)$/m.exec(toml)[1]), args: JSON.parse(/^args = (.*)$/m.exec(toml)[1]),
    env: Object.fromEntries([.../^env = \{(.*)\}$/m.exec(toml)[1].matchAll(/(\w+) = ("[^"]*")/g)].map(m => [m[1], JSON.parse(m[2])])) };
} else server = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.usability;
const [, tool, json] = /Call (\w+) with exactly these arguments: (.*)$/m.exec(prompt);
const client = new Client({ name: 'fake-host', version: '1' });
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: { ...process.env, ...server.env } }));
const call = async (name, a) => JSON.parse((await client.callTool({ name, arguments: a })).content.find(c => c.type === 'text').text);
let state = await call(tool, JSON.parse(json));
let first = true;
while (state.phase !== 'finished') {
  if (state.phase === 'awaiting_findings') { state = await call('usability_submit_findings', { runId: state.runId, requestId: state.requestId, findings: [] }); continue; }
  const decision = { stateSummary: 'Fixture screen', simulatedCommentary: 'Test double', userExpectation: null, confidence: 0.5, friction: null, behavior: 'progress',
    selectedAction: { type: 'finish', outcome: 'incomplete', reason: 'Test double stops', visibleEvidence: 'Fixture heading' }, ...(first ? { contextIsolation: 'host-reported fresh' } : {}) };
  first = false;
  state = await call('usability_advance_session', { runId: state.runId, requestId: state.requestId, decision });
  if (state.error) throw new Error(state.error);
}
await client.close();
reply(`Done.\n{"runId": "${state.runId}", "status": "${state.status}"}`);
