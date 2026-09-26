import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../src/mcp/server.js';
import { makeDecision } from '../fixtures/provider.js';
import { renderPrototypeFixture } from '../fixtures/prototype.js';

const fresh = { mode: 'first-visit', isolation: 'host-reported fresh', exposure: [] };
test('static design flows run through the same MCP: taps, misclicks, move-on, back, reports, rounds and plans', async () => {
  const { dir, manifest } = await renderPrototypeFixture();
  const root = await mkdtemp(join(tmpdir(), 'prototype-mcp-'));
  const server = createServer({ artifactRoot: root, headless: true }); const client = new Client({ name: 'prototype-test-double', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>, error = false) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(Boolean(result.isError), error, JSON.stringify(result.content).slice(0, 500));
    const text = (result.content as { type: string; text: string }[]).find(c => c.type === 'text')!.text;
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    return { ...parsed, images: (result.content as { type: string }[]).filter(c => c.type === 'image').length };
  };
  try {
    const imported = await call('usability_import_prototype', manifest);
    const prototypeId = imported.prototype.prototypeId;
    assert.deepEqual(imported.prototype.screens.map((s: { target: string }) => s.target), ['owner-marked: Get started', 'unscored', 'end of flow']);
    await call('usability_test_prototype', { prototypeId, goal: 'Start using the product on a plan' }, true); // contextCheck required
    let state = await call('usability_test_prototype', { prototypeId, goal: 'Start using the product on a plan', contextCheck: fresh });
    const runId = state.runId;
    assert.equal(state.images, 1);
    const packet = JSON.stringify(state.participant);
    assert(!packet.includes('SECRET-FRAME-NAME') && !packet.includes('owner-marked') && !packet.includes('"label"') && !/"screens"|"targets"/.test(packet), 'no frame names, targets or flow structure reach participants');
    assert.match(state.participant.observation.visibleText, /Welcome to Ledger/);
    const tap = (x: number, y: number, label: string) => { const d = makeDecision({ type: 'tap_point', x, y, visibleLabel: label, capability: null }); d.contextIsolation = 'host-reported fresh'; return d; };
    const act = async (decision: ReturnType<typeof makeDecision>) => { state = await call('usability_advance_session', { runId, requestId: state.requestId, decision }); return state; };
    await act(tap(0.1, 0.1, 'Heading'));            // miss 1: nothing happens
    assert.match(state.participant.history[0].result.message, /Nothing happens/);
    assert.match(state.participant.observation.visibleText, /Welcome/);
    await act(tap(0.9, 0.9, 'Empty corner'));       // miss 2
    await act(tap(0.1, 0.9, 'Empty corner'));       // miss 3: facilitator moves on
    assert.match(state.participant.observation.visibleText, /Choose a plan/);
    await act(makeDecision({ type: 'back' }));      // back to welcome
    assert.match(state.participant.observation.visibleText, /Welcome/);
    await act(tap(0.5, 0.733, 'Get started'));      // hit
    assert.match(state.participant.observation.visibleText, /Choose a plan/);
    await act(tap(0.2, 0.2, 'Starter plan'));       // unscored: advances
    assert.match(state.participant.observation.visibleText, /all set/);
    await act(tap(0.5, 0.5, 'Done'));               // end of flow
    assert.match(state.participant.history.at(-1).result.message, /End of the designed flow/);
    await act(makeDecision({ type: 'finish', outcome: 'completed', reason: 'Set up', visibleEvidence: 'You are all set' }));
    assert.equal(state.phase, 'awaiting_findings');
    state = await call('usability_submit_findings', { runId, requestId: state.requestId, findings: [
      { title: 'Get started button not recognised first', category: 'affordance', stepNumbers: [1, 2, 3], likelyUsabilityProblem: 'Three taps missed the start button', recommendation: 'Make the primary action more prominent', taskImpact: 'minor-delay', confidence: 'medium' }] });
    assert.equal(state.status, 'completed');
    const md = (await client.callTool({ name: 'usability_get_report', arguments: { id: runId, format: 'markdown' } })).content as { text: string }[];
    assert.match(md[0]!.text, /static design prototype/);
    assert.match(md[0]!.text, /Prototype:\*\* first tap on target on 0 of 1 scored screen visit\(s\); 3 misclick\(s\); facilitator moved on 1 time\(s\); 2 unscored tap\(s\)/);
    assert.match(md[0]!.text, /Accessibility not assessed: static images/);
    const details = (await client.callTool({ name: 'usability_get_report', arguments: { id: runId, format: 'details' } })).content as { text: string }[];
    assert.match(details[0]!.text, /Prototype tap: missed the marked target; facilitator moved on/);
    assert.match(details[0]!.text, /Prototype tap: on the marked target/);
    // Re-importing the same flow after design edits gets a new ID but stays comparable for retests.
    const again = await call('usability_import_prototype', manifest);
    let retest = await call('usability_test_prototype', { prototypeId: again.prototype.prototypeId, goal: 'Start using the product on a plan', contextCheck: fresh });
    const quit = makeDecision({ type: 'finish', outcome: 'incomplete', reason: 'Stopped', visibleEvidence: 'Welcome' }); quit.contextIsolation = 'host-reported fresh';
    retest = await call('usability_advance_session', { runId: retest.runId, requestId: retest.requestId, decision: quit });
    await call('usability_submit_findings', { runId: retest.runId, requestId: retest.requestId, findings: [] });
    const comparison = await call('usability_compare_runs', { baselineId: runId, retestId: retest.runId });
    assert.equal(comparison.comparable, true, JSON.stringify(comparison.mismatches));
    // Three participants on the same flow.
    let round = await call('usability_test_prototype', { prototypeId, goal: 'Start using the product on a plan', contextCheck: fresh, participantCount: 3 });
    for (let i = 0; i < 3; i++) {
      const d = makeDecision({ type: 'finish', outcome: 'incomplete', reason: 'Stopped', visibleEvidence: 'Welcome' }); d.contextIsolation = 'host-reported fresh';
      round = await call('usability_advance_session', { runId: round.runId, requestId: round.requestId, decision: d });
    }
    assert.equal(round.phase, 'finished'); assert.equal(round.taskOutcomes.length, 3);
    // A saved plan can target the prototype.
    const saved = await call('usability_save_project', { name: 'Onboarding design', platform: 'prototype', target: prototypeId,
      answers: { purpose: 'Accounting', audience: 'Owners', priority: 'Onboarding', success: 'Set-up screen reached', boundaries: 'Design only' },
      personas: [{ id: 'owner', context: 'Small business owner' }],
      journeys: [{ id: 'start', personaIds: ['owner'], scenario: 'You run a small café and want simpler bookkeeping because tax season is close.', goal: 'Get started on a plan that suits you.', successCriteria: ['Set-up screen is visible'] }] });
    await call('usability_approve_project', { projectId: saved.profile.id, ownerApproved: true });
    const run = await call('usability_run_project', { projectId: saved.profile.id, journeyId: 'start', options: { contextCheck: fresh } });
    assert.match(run.participant.observation.visibleText, /Welcome/);
    await call('usability_cancel_session', { runId: run.runId });
  } finally { await client.close(); await server.close(); await rm(root, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});
