import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../src/mcp/server.js';
import { startFixture } from '../fixtures/site.js';
import { makeDecision } from '../fixtures/provider.js';

test('focused tests start on the focus page, track leaving it, and keep reports on the focus', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'focus-'));
  const server = createServer({ artifactRoot: root, headless: true }); const client = new Client({ name: 'focus-test-double', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>, error = false) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(Boolean(result.isError), error, JSON.stringify(result.content).slice(0, 500));
    const text = (result.content as { type: string; text: string }[]).find(c => c.type === 'text')!.text;
    try { return JSON.parse(text); } catch { return text; }
  };
  const focus = { name: 'Plan selection area', description: 'Plans and workspace setup', startPath: '/plans', includePaths: ['/plans', '/start'] };
  try {
    let state = await call('usability_quick_test', { target: fixture.url, goal: 'Start setting up a workspace on a suitable plan', focus });
    const runId = state.runId;
    assert.match(state.participant.observation.location, /\/plans$/, 'starts on the focus page');
    const packet = JSON.stringify(state.participant);
    assert(!packet.includes('Plan selection area') && !packet.includes('includePaths') && !packet.includes('"focus"'), 'participants never see the focus boundary');
    const act = async (decision: ReturnType<typeof makeDecision>) => { state = await call('usability_advance_session', { runId, requestId: state.requestId, decision }); return state; };
    const click = (name: string) => makeDecision({ type: 'click', target: state.participant.observation.candidates.find((c: { name: string }) => c.name === name).ref, capability: null });
    await act(click('Home'));                     // step 1: outside
    await act(click('Options'));                  // step 2: back inside, streak resets
    assert.equal(state.phase, 'awaiting_decision', 'a short detour does not end the journey');
    await act(click('Home'));                     // step 3: outside (1)
    await act(makeDecision({ type: 'scroll', direction: 'down' })); // step 4: outside (2)
    await act(makeDecision({ type: 'scroll', direction: 'up' }));   // step 5: outside (3) -> ends
    assert.equal(state.phase, 'awaiting_findings');
    const steps = state.session.journey.map((s: { focus: string }) => s.focus);
    assert.deepEqual(steps, ['outside', 'inside', 'outside', 'outside', 'outside']);
    assert.match(state.session.reason, /Left the focus area \(3 consecutive steps outside "Plan selection area"\)/);
    const finding = { category: 'navigation', likelyUsabilityProblem: 'x', recommendation: 'y', taskImpact: 'minor-delay', confidence: 'medium' };
    state = await call('usability_submit_findings', { runId, requestId: state.requestId, findings: [
      { ...finding, title: 'Plans page lacks a clear next step', stepNumbers: [2] },
      { ...finding, title: 'Home page promo distracts', stepNumbers: [4] }] });
    assert.equal(state.status, 'incomplete');
    const md = await call('usability_get_report', { id: runId, format: 'markdown' });
    assert.match(md, /\*\*Focus:\*\* Plan selection area \(\/plans, \/start\)\. 4 step\(s\) outside the focus area; 1 journey\(s\) ended after leaving it/);
    assert.match(md, /Plans page lacks a clear next step/); assert.doesNotMatch(md, /Home page promo distracts/);
    assert.match(md, /1 finding\(s\) happened only outside the focus area/);
    const details = await call('usability_get_report', { id: runId, format: 'details' });
    assert.match(details, /Focus area: Plan selection area/); assert.match(details, /## Outside the focus area[\s\S]*Home page promo distracts/);
    assert.match(details, /Step 1 \(outside focus\)/);
    // A retest with a different focus is not comparable.
    const unfocused = await call('usability_quick_test', { target: fixture.url, goal: 'Start setting up a workspace on a suitable plan' });
    await call('usability_cancel_session', { runId: unfocused.runId });
    const compare = await call('usability_compare_runs', { baselineId: unfocused.runId, retestId: runId });
    assert.equal(compare.comparable, false); assert.match(compare.mismatches.join(), /different focus area/);
    // Focused setup scan starts on the focus page and only follows in-scope links.
    const scan = await call('usability_discover_product', { platform: 'web', target: fixture.url, startPath: '/plans', includePaths: ['/plans', '/start'] });
    const locations = scan.discovery.observations.map((o: { observation: { location: string } }) => new URL(o.observation.location).pathname);
    assert.deepEqual(locations, ['/plans', '/start']);
    // Saved plans: a journey's focus area sets its start page.
    const saved = await call('usability_save_project', { name: 'Ledger', target: fixture.url, discoveryId: scan.discovery.id,
      answers: { purpose: 'Accounting', audience: 'Owners', priority: 'Plans', success: 'Setup visible', boundaries: 'Read only', focus: 'Plan selection' },
      personas: [{ id: 'owner', context: 'Small business owner' }],
      focusAreas: [{ id: 'plans', ...focus }],
      journeys: [{ id: 'setup', personaIds: ['owner'], focusAreaId: 'plans', scenario: 'You run a small café and are choosing accounting software because tax season is close.', goal: 'Start setting up a workspace on a suitable plan.', successCriteria: ['Workspace setup is visible'] }] });
    assert.deepEqual(saved.taskReview.warnings, []);
    await call('usability_save_project', { ...saved.profile.plan, journeys: [{ ...saved.profile.plan.journeys[0], focusAreaId: 'missing' }] }, true);
    await call('usability_approve_project', { projectId: saved.profile.id, ownerApproved: true });
    const options = { handoff: { discoveryId: scan.discovery.id, context: 'host-reported fresh' } };
    const preview = await call('usability_preview_project_run', { projectId: saved.profile.id, journeyId: 'setup', options });
    assert.match(preview.target, /\/plans$/); assert.equal(preview.assignment.focusArea, 'plans');
    const projectRun = await call('usability_run_project', { projectId: saved.profile.id, journeyId: 'setup', options });
    assert.match(projectRun.participant.observation.location, /\/plans$/);
    await call('usability_cancel_session', { runId: projectRun.runId });
    assert.equal(fixture.mutations(), 0);
  } finally { await client.close(); await server.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
