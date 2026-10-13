import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runParticipant, ParticipantError, prepareStart, parseCanary } from '../../bin/participant.mjs';

const fakeHost = fileURLToPath(new URL('../fixtures/fake-host.mjs', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));
process.env.USABILITY_HEADLESS = 'true';
async function setup() {
  const site = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Fixture</title><h1>Fixture heading</h1>'); });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  const root = await mkdtemp(join(tmpdir(), 'participant-runner-'));
  const log = join(root, 'host-log.jsonl'); process.env.FAKE_HOST_LOG = log;
  const start = { tool: 'usability_quick_test', arguments: { target: `http://127.0.0.1:${site.address().port}/`, goal: 'Read the heading', presentation: 'background' } };
  return { root, log, start, artifacts: join(root, 'artifacts'), close: async () => { await new Promise(r => site.close(r)); await rm(root, { recursive: true, force: true }); delete process.env.FAKE_HOST_FAIL; delete process.env.FAKE_HOST_LEAK; } };
}
const entries = async log => (await readFile(log, 'utf8')).trim().split('\n').map(l => JSON.parse(l));

for (const host of ['claude', 'codex']) {
  test(`${host}: an isolated participant runs the test end to end and records how it was isolated`, async () => {
    const f = await setup();
    const savedHome = process.env.CODEX_HOME;
    if (host === 'codex') { process.env.CODEX_HOME = join(f.root, 'user-codex'); await import('node:fs/promises').then(fs => fs.mkdir(process.env.CODEX_HOME)); await writeFile(join(process.env.CODEX_HOME, 'auth.json'), '{"fake":true}'); }
    try {
      const out = await runParticipant({ host, start: f.start, artifacts: f.artifacts, hostBin: fakeHost });
      assert.equal(out.ok, true); assert.equal(out.status, 'incomplete'); assert.equal(out.canary, 'passed');
      const record = JSON.parse(await readFile(join(f.artifacts, 'sessions', out.runId, 'participant-run.json'), 'utf8'));
      assert.equal(record.isolation, 'headless-process'); assert.equal(record.firstDecisionContext, 'host-reported fresh'); assert.equal(record.completed, true);
      assert(record.canary.terms.includes('127.0.0.1'));
      assert(!existsSync(join(f.artifacts, 'active-run.json')), 'lock removed');
      const calls = await entries(f.log);
      assert.equal(calls.length, 3, 'preflight, canary, participant');
      for (const call of calls) {
        assert(!call.cwd.startsWith(repo), 'participant never runs inside the project folder');
        assert(!JSON.stringify(call.args).includes(repo), 'no project paths reach the participant');
        if (host === 'claude') {
          for (const flag of ['--strict-mcp-config', '--no-session-persistence']) assert(call.args.includes(flag));
          assert.deepEqual(call.args.slice(call.args.indexOf('--setting-sources'), call.args.indexOf('--setting-sources') + 2), ['--setting-sources', 'user']);
          for (const denied of ['Bash', 'Read', 'WebFetch', 'Agent', 'Skill', 'SendMessage']) assert(call.args.includes(denied));
        } else {
          assert(call.codexHome && !call.codexHome.includes('user-codex'), 'private CODEX_HOME');
          assert(call.args.includes('read-only'));
        }
      }
      const report = JSON.parse(await readFile(join(f.artifacts, 'sessions', out.runId, 'report.json'), 'utf8'));
      assert.equal(report.findings.length, 0, 'the participant does not evaluate');
    } finally { if (host === 'codex') { if (savedHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = savedHome; } await f.close(); }
  });
}

test('preflight, canary and lock stop the run before anything starts', async () => {
  const f = await setup();
  try {
    process.env.FAKE_HOST_FAIL = 'auth';
    await assert.rejects(runParticipant({ host: 'claude', start: f.start, artifacts: f.artifacts, hostBin: fakeHost }), e => e instanceof ParticipantError && e.code === 2 && /claude \/login/.test(e.message));
    delete process.env.FAKE_HOST_FAIL;
    process.env.FAKE_HOST_LEAK = 'Acme';
    await assert.rejects(runParticipant({ host: 'claude', start: f.start, artifacts: f.artifacts, hostBin: fakeHost }), e => e.code === 3 && /Acme/.test(e.message) && /informed walkthrough/.test(e.message));
    delete process.env.FAKE_HOST_LEAK;
    assert.deepEqual(await readdir(f.artifacts).then(d => d.filter(n => n === 'sessions')), [], 'no session was started');
    await writeFile(join(f.artifacts, 'active-run.json'), JSON.stringify({ pid: process.pid, startedAt: 'earlier', tool: 'usability_quick_test' }));
    await assert.rejects(runParticipant({ host: 'claude', start: f.start, artifacts: f.artifacts, hostBin: fakeHost }), e => e.code === 4 && /Another participant is running/.test(e.message));
    await writeFile(join(f.artifacts, 'active-run.json'), JSON.stringify({ pid: 2147483646, startedAt: 'long ago', tool: 'x' }));
    const out = await runParticipant({ host: 'claude', start: f.start, artifacts: f.artifacts, hostBin: fakeHost, checkOnly: true });
    assert.equal(out.check, 'passed', 'stale lock from a dead process is cleaned');
    assert(!existsSync(join(f.artifacts, 'active-run.json')));
  } finally { await f.close(); }
});

test('runner forces one clean first-visit participant and reads canary replies strictly', async () => {
  const prepared = prepareStart({ tool: 'usability_run_project', arguments: { projectId: 'project-x', journeyId: 'j', participantCount: 3 } });
  assert.equal(prepared.arguments.participantCount, 1);
  assert.deepEqual(prepared.arguments.options.contextCheck, { mode: 'first-visit', isolation: 'host-reported fresh', exposure: [] });
  assert.throws(() => prepareStart({ tool: 'usability_quick_test', arguments: { contextCheck: { mode: 'informed-walkthrough', isolation: 'shared', exposure: [] } } }), /first-visit/);
  assert.throws(() => prepareStart({ tool: 'usability_get_report', arguments: {} }), /--start/);
  const { participantPrompt } = await import('../../bin/participant.mjs');
  assert.match(participantPrompt(prepareStart({ tool: 'usability_test_prototype', arguments: { prototypeId: 'prototype-x', goal: 'g', contextCheck: { mode: 'first-visit', isolation: 'host-reported fresh', exposure: [] } } })), /static design: nothing you tap/);
  assert.match(participantPrompt(prepareStart({ tool: 'usability_quick_test', arguments: { target: 'https://x.test', goal: 'g' } })), /Never fill in forms/);
  assert.equal(parseCanary('{"mentions": [], "projectMaterial": []}').passed, true);
  assert.equal(parseCanary('NONE').passed, false, 'non-JSON is not a pass');
  assert.equal(parseCanary('{"mentions": ["Acme"], "projectMaterial": []}').passed, false);
});
