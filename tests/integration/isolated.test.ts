import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../src/mcp/server.js';
import { startFixture } from '../fixtures/site.js';
import { makeDecision } from '../fixtures/provider.js';

const fresh = { mode: 'first-visit', isolation: 'host-reported fresh', exposure: [] };
test('isolated sessions are evaluated by the coordinator and combined into a comparison round', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'isolated-'));
  const server = createServer({ artifactRoot: root, headless: true }); const client = new Client({ name: 'coordinator-test-double', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>, error = false) => {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(Boolean(r.isError), error, JSON.stringify(r.content).slice(0, 400));
    const text = (r.content as { type: string; text: string }[]).find(c => c.type === 'text')!.text;
    try { return JSON.parse(text); } catch { return text; }
  };
  // Stands in for the runner: each participant is its own session that submits no findings.
  const participant = async (goal = 'Find the monthly price') => {
    let s = await call('usability_quick_test', { target: fixture.url, goal, contextCheck: fresh });
    const options = s.participant.observation.candidates.find((c: { name: string }) => c.name === 'Options');
    const click = makeDecision({ type: 'click', target: options.ref, capability: null }); click.contextIsolation = 'host-reported fresh';
    s = await call('usability_advance_session', { runId: s.runId, requestId: s.requestId, decision: click });
    s = await call('usability_advance_session', { runId: s.runId, requestId: s.requestId, decision: makeDecision({ type: 'finish', outcome: 'completed', reason: 'Price found', visibleEvidence: '$12 per month' }) });
    s = await call('usability_submit_findings', { runId: s.runId, requestId: s.requestId, findings: [] });
    await writeFile(join(root, 'sessions', s.runId, 'participant-run.json'), JSON.stringify({ isolation: 'headless-process', host: 'claude', method: 'test', canary: { terms: ['127.0.0.1'], passed: true },
      startedAt: '', finishedAt: '', firstDecisionContext: 'host-reported fresh', completed: true }));
    return s.runId as string;
  };
  try {
    const ids = [await participant(), await participant(), await participant()];
    const finding = { title: 'Pricing hidden behind Options', category: 'navigation', likelyUsabilityProblem: 'Label does not name pricing', recommendation: 'Rename the link', taskImpact: 'minor-delay', confidence: 'medium' };
    await call('usability_review_session', { sessionId: ids[0], findings: [{ ...finding, stepNumbers: [9] }] }, true);
    await call('usability_review_session', { sessionId: ids[0], findings: [{ ...finding, stepNumbers: [1], suggestedChange: { kind: 'copy', location: 'Home', proposal: 'Rename', verify: 'Retest', replacement: { before: 'Invented label', after: 'Pricing' } } }] }, true);
    const reviewed = await call('usability_review_session', { sessionId: ids[0], findings: [{ ...finding, stepNumbers: [1] }] });
    assert.equal(reviewed.findings, 1);
    const single = await call('usability_get_report', { id: ids[0], format: 'json' });
    assert.equal(single.evaluation.by, 'coordinator'); assert.equal(single.participantRun.isolation, 'headless-process');
    const md = await call('usability_get_report', { id: ids[0], format: 'markdown' });
    assert.match(md, /ran as its own headless process with no project files, memory or other tools/);
    assert.match(md, /Pricing hidden behind Options/);
    // Combining needs identical tasks and finished sessions.
    const other = await participant('Find the contact details');
    assert.match((await call('usability_combine_sessions', { sessionIds: [ids[0], other] }, true)).error, /not the same task/);
    const running = await call('usability_quick_test', { target: fixture.url, goal: 'Find the monthly price', contextCheck: fresh });
    assert.match((await call('usability_combine_sessions', { sessionIds: [ids[0], running.runId] }, true)).error, /still running|finish/i);
    await call('usability_cancel_session', { runId: running.runId });
    const combined = await call('usability_combine_sessions', { sessionIds: ids });
    assert(combined.sessions.every((s: { isolatedProcess: boolean }) => s.isolatedProcess));
    let review = await call('usability_get_review', { id: combined.roundId });
    assert.equal(review.stage, 'participants'); assert.equal(review.report.findings.length, 0);
    assert(review.report.comparison.participants.every((p: { contextIsolation: string }) => p.contextIsolation === 'isolated headless process'));
    review = await call('usability_submit_review', { id: combined.roundId, revision: 0, submission: { stage: 'participants', sessions: ids.map(sessionId => ({ sessionId, findings: [{ ...finding, stepNumbers: [1] }] })) } });
    assert.equal(review.stage, 'synthesis');
    const roundMd = await call('usability_get_report', { id: combined.roundId, format: 'markdown' });
    assert.match(roundMd, /separate headless process per participant/);
    assert.equal(fixture.mutations(), 0);
  } finally { await client.close(); await server.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
