import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../src/mcp/server.js';
import { startFixture } from '../fixtures/site.js';
import { makeDecision } from '../fixtures/provider.js';

test('three quick journeys defer reviews, retain isolated history, and complete saved reviews after restart', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'comparison-'));
  let server = createServer({ artifactRoot: root, headless: true });
  let client = new Client({ name: 'comparison-fixture-test-double', version: '1' });
  const connect = async () => { const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a); };
  const call = async (name: string, args: Record<string,unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, JSON.stringify(result.content));
    return JSON.parse((result.content as {type:string;text:string}[]).find(c => c.type === 'text')!.text);
  };
  try {
    await connect();
    let state = await call('usability_quick_test', { target: fixture.url, goal: 'Find the monthly plan price', participantCount: 3 });
    const id = state.runId; const ids: string[] = []; const profiles: unknown[] = [];
    const premature = await client.callTool({ name: 'usability_get_review', arguments: { id } });
    assert(premature.isError);
    while (state.phase !== 'finished') {
      assert.equal(state.phase, 'awaiting_decision', 'No interpretations may appear between journeys');
      const p = state.participant;
      if (!ids.includes(p.sessionId)) {
        ids.push(p.sessionId); profiles.push(p.persona);
        assert.equal(p.history.length, 0); assert.match(p.observation.visibleText, /First visit/);
        assert.equal(p.persona.basis, 'assumption');
        assert(!JSON.stringify(p).includes('reviews'));
      }
      const options = p.observation.candidates.find((c: {name:string}) => c.name === 'Options');
      // First two take an extra visible inspection step; the third takes the direct path.
      const decision = p.observation.visibleText.includes('$12')
        ? makeDecision({ type: 'finish', outcome: 'completed', reason: 'Price visible', visibleEvidence: '$12 per month' })
        : ids.length < 3 && p.history.length === 0
          ? makeDecision({ type: 'scroll', direction: 'down' }, 'Fixture: looking for pricing')
          : !options ? makeDecision({ type: 'scroll', direction: 'up' })
          : makeDecision({ type: 'click', target: options.ref, capability: null });
      decision.contextIsolation = 'shared';
      state = await call('usability_advance_session', { runId: id, requestId: state.requestId, decision });
    }
    assert.equal(ids.length, 3); assert.equal(new Set(profiles.map(p => JSON.stringify(p))).size, 3);
    assert.equal(state.nextTool, 'usability_get_review');
    let review = await call('usability_get_review', { id });
    assert.equal(review.stage, 'participants');
    assert(review.report.comparison.participants.every((p: {contextIsolation:string}) => p.contextIsolation === 'shared'));
    const requests = fixture.reads();
    await client.close(); await server.close();
    server = createServer({ artifactRoot: root, headless: true });
    client = new Client({ name: 'review-restart-test-double', version: '1' }); await connect();
    review = await call('usability_get_review', { id });
    const findings = ids.map((sessionId, i) => ({ sessionId, findings: i === 2 ? [] : [{ title: i === 0 ? 'Pricing label unclear' : 'Options obscures plan costs', category: 'navigation', stepNumbers: [1], likelyUsabilityProblem: 'Pricing takes extra searching', recommendation: 'Name the pricing destination', taskImpact: 'minor-delay', confidence: 'medium' }] }));
    const submission = { stage: 'participants', sessions: findings };
    review = await call('usability_submit_review', { id, revision: 0, submission });
    const repeated = await call('usability_submit_review', { id, revision: 0, submission });
    assert.equal(repeated.revision, 1); assert.equal(repeated.report.findings.length, 2);
    const image = await client.callTool({ name: 'usability_get_review', arguments: { id, sessionId: ids[0], step: 1 } });
    assert((image.content as {type:string}[]).some(c => c.type === 'image'));
    review = await call('usability_submit_review', { id, revision: 1, submission: { stage: 'synthesis', patterns: [{
      title: 'Pricing requires extra searching', screenOrControl: 'Home: Options link', obstacle: 'Label does not name pricing',
      findingIds: review.report.findings.map((f: {id:string}) => f.id), recommendation: 'Use Pricing',
      assessments: ids.map((participantId, i) => ({ participantId, status: i === 2 ? 'successful' : 'experienced', explanation: i === 2 ? 'Direct path succeeded without searching' : 'Extra search before reaching price', evidence: [{ sessionId: participantId, step: 1 }] })),
    }] } });
    assert.equal(review.report.comparison.patterns[0].participantCount, 2);
    for (const stage of ['ux', 'content']) {
      review = await call('usability_submit_review', { id, revision: review.revision, submission: { stage, notes: [{ title: `${stage} fixture observation`, observation: 'Options is visible on the home page', recommendation: 'Consider naming the destination', evidence: [{ sessionId: ids[2], step: 1 }] }] } });
    }
    assert.equal(review.stage, 'complete');
    assert.equal(review.report.findings.length, 2, 'Expert notes must not increase observations');
    assert.equal(fixture.reads(), requests, 'Saved reviews must not rerun browsers');
    const markdown = await client.callTool({ name: 'usability_get_report', arguments: { id, format: 'markdown' } });
    const md = (markdown.content as {text:string}[])[0]!.text;
    assert.match(md, /Observed in 2 simulated/); assert.match(md, /successful/);
    assert.match(md, /UX expert review/); assert.match(md, /Content expert review/);
    assert.equal(fixture.mutations(), 0);
  } finally { await client.close(); await server.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
