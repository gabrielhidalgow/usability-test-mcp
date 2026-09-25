import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../src/mcp/server.js';
import { startFixture } from '../fixtures/site.js';
import { makeDecision } from '../fixtures/provider.js';
import { PRINCIPLES } from '../../src/methodology/principles.js';

async function harness() {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'methodology-flows-'));
  const state = { server: createServer({ artifactRoot: root, headless: true }), client: new Client({ name: 'methodology-test-double', version: '1' }) };
  const connect = async () => { const [a, b] = InMemoryTransport.createLinkedPair(); await state.server.connect(b); await state.client.connect(a); };
  const call = async (name: string, args: Record<string, unknown>, error = false) => {
    const result = await state.client.callTool({ name, arguments: args });
    assert.equal(Boolean(result.isError), error, JSON.stringify(result.content).slice(0, 600));
    const text = (result.content as { type: string; text: string }[]).find(c => c.type === 'text')!.text;
    try { return JSON.parse(text); } catch { return text; }
  };
  const restart = async () => { await state.client.close(); await state.server.close(); state.server = createServer({ artifactRoot: root, headless: true }); state.client = new Client({ name: 'restarted', version: '1' }); await connect(); };
  const close = async () => { await state.client.close(); await state.server.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); };
  await connect();
  return { fixture, call, restart, close, state };
}
const noMethodology = (packet: unknown) => {
  const text = JSON.stringify(packet);
  for (const p of PRINCIPLES) assert(!text.includes(p.id), `participant packet leaked principle ${p.id}`);
  assert(!/methodology|principleIds/i.test(text));
};

test('first-impression exercise: scroll-only, labelled separately, never pooled or compared', async () => {
  const h = await harness();
  try {
    let state = await h.call('usability_quick_test', { target: h.fixture.url, goal: 'Describe what this product is and who it is for', exercise: 'first-impression' });
    assert.equal(state.participant.exercise, 'first-impression'); noMethodology(state.participant);
    assert.doesNotMatch(state.instructions, /principleIds/);
    state = await h.call('usability_advance_session', { runId: state.runId, requestId: state.requestId, decision: makeDecision({ type: 'scroll', direction: 'down' }, 'Looks like accounting software for small businesses') });
    const runId = state.runId;
    state = await h.call('usability_advance_session', { runId, requestId: state.requestId, decision: makeDecision({ type: 'finish', outcome: 'completed', reason: 'Described', visibleEvidence: 'Simple accounting for small businesses; an Options link' }) });
    state = await h.call('usability_submit_findings', { runId, requestId: state.requestId, findings: [] });
    assert.equal(state.status, 'completed');
    const md = await h.call('usability_get_report', { id: runId, format: 'markdown' });
    assert.match(md, /First-impression exercise — not a task outcome/); assert.match(md, /Simple accounting for small businesses/);
    assert.doesNotMatch(md, /Reported completion/);
    assert.match(await h.call('usability_get_report', { id: runId, format: 'details' }), /FIRST-IMPRESSION EXERCISE/);
    // Clicking is outside the exercise and ends it as blocked without navigating.
    let clicked = await h.call('usability_quick_test', { target: h.fixture.url, goal: 'Describe the product', exercise: 'first-impression' });
    const options = clicked.participant.observation.candidates.find((c: { name: string }) => c.name === 'Options');
    clicked = await h.call('usability_advance_session', { runId: clicked.runId, requestId: clicked.requestId, decision: makeDecision({ type: 'click', target: options.ref, capability: null }) });
    assert.equal(clicked.phase, 'finished'); assert.equal(clicked.status, 'blocked');
    assert.match(clicked.taskOutcomes[0].reason, /scrolling and finishing only/);
    // Never pooled into rounds, never used as a baseline.
    await h.call('usability_quick_test', { target: h.fixture.url, goal: 'Describe', exercise: 'first-impression', participantCount: 3 }, true);
    await h.call('usability_run_round', { target: h.fixture.url, scenario: 'x', goal: 'y', exercise: 'first-impression' }, true);
    const compare = await h.call('usability_compare_runs', { baselineId: runId, retestId: clicked.runId }, true);
    assert.match(compare.error, /First-impression/);
    assert.equal((await h.state.client.listPrompts()).prompts.some(p => p.name === 'first-impression'), true);
    assert.equal(h.fixture.mutations(), 0);
  } finally { await h.close(); }
});

test('baseline → retest comparison validates evidence, respects comparability and survives restart', async () => {
  const h = await harness();
  const finding = { title: 'Pricing hidden behind Options', category: 'navigation', stepNumbers: [1], likelyUsabilityProblem: 'Label does not name pricing', recommendation: 'Rename the link', taskImpact: 'minor-delay', confidence: 'medium', principleIds: ['mindless-choices'] };
  const run = async (extra: Record<string, unknown>, findings: unknown[]) => {
    let state = await h.call('usability_quick_test', { target: h.fixture.url, goal: 'Find the monthly price', ...extra });
    const runId = state.runId; noMethodology(state.participant);
    const options = state.participant.observation.candidates.find((c: { name: string }) => c.name === 'Options');
    const click = makeDecision({ type: 'click', target: options.ref, capability: null }, 'Options might lead to prices');
    click.userExpectation = 'A page with plan prices';
    state = await h.call('usability_advance_session', { runId, requestId: state.requestId, decision: click });
    assert.equal(state.participant.history[0].userExpectation, 'A page with plan prices', 'participant sees only its own expectations');
    state = await h.call('usability_advance_session', { runId, requestId: state.requestId, decision: makeDecision({ type: 'finish', outcome: 'completed', reason: 'Price visible', visibleEvidence: '$12 per month' }) });
    state = await h.call('usability_submit_findings', { runId, requestId: state.requestId, findings });
    assert.equal(state.phase, 'finished');
    return runId;
  };
  try {
    const baseline = await run({}, [finding]);
    const retest = await run({}, [{ ...finding, title: 'Plan names unclear', principleIds: undefined }]);
    const inputs = await h.call('usability_compare_runs', { baselineId: baseline, retestId: retest });
    assert.equal(inputs.comparable, true); assert.equal(inputs.baseline.findings.length, 1);
    assert.match(inputs.instructions, /never write "fixed"/);
    const baseFinding = inputs.baseline.findings[0].id; const retestFinding = inputs.retest.findings[0].id;
    const submit = (assessments: unknown[], newlyObserved: string[] = []) => ({ baselineId: baseline, retestId: retest, assessments, newlyObserved });
    const assessment = { baselineFindingId: baseFinding, outcome: 'not-observed-on-comparable-path', explanation: 'Reached the plans page directly', retestEvidence: [{ sessionId: retest, step: 1 }] };
    await h.call('usability_submit_run_comparison', submit([]), true);
    await h.call('usability_submit_run_comparison', submit([{ ...assessment, retestEvidence: [] }]), true);
    await h.call('usability_submit_run_comparison', submit([{ ...assessment, retestEvidence: [{ sessionId: retest, step: 9 }] }]), true);
    await h.call('usability_submit_run_comparison', submit([assessment], ['U-999']), true);
    const saved = await h.call('usability_submit_run_comparison', submit([assessment], [retestFinding]));
    assert.equal(saved.comparison.revision, 1);
    assert.equal((await h.call('usability_submit_run_comparison', submit([assessment], [retestFinding]))).comparison.revision, 1, 'exact retries are idempotent');
    await h.restart();
    const md = await h.call('usability_get_report', { id: retest, format: 'markdown' });
    assert.match(md, /Retest:\*\* Compared with baseline/); assert.match(md, /1 not observed on a comparable path/); assert.match(md, /not proof it is fixed/);
    const details = await h.call('usability_get_report', { id: retest, format: 'details' });
    assert.match(details, /Baseline → retest comparison/); assert.match(details, /Newly observed in the retest: U-001/);
    assert.match(details, /Expected: A page with plan prices → Result:/);
    // Different device: flagged and restricted.
    const mobile = await run({ device: 'mobile' }, [finding]);
    const mismatch = await h.call('usability_compare_runs', { baselineId: baseline, retestId: mobile });
    assert.equal(mismatch.comparable, false); assert.match(mismatch.mismatches.join(), /viewport/);
    const denied = await h.call('usability_submit_run_comparison', { baselineId: baseline, retestId: mobile, assessments: [{ ...assessment, retestEvidence: [{ sessionId: mobile, step: 1 }] }] }, true);
    assert.match(denied.error, /not comparable/);
    await h.call('usability_submit_run_comparison', { baselineId: baseline, retestId: mobile, assessments: [{ ...assessment, outcome: 'inconclusive', retestEvidence: [] }] });
    // A correction supersedes an invalid attempt; it is not a retest.
    const invalid = await run({}, []);
    const corrected = await run({ rerun: { priorRunId: invalid, reason: 'other', changes: 'Fixture correction' } }, []);
    assert.match((await h.call('usability_compare_runs', { baselineId: invalid, retestId: corrected }, true)).error, /superseded/);
    assert.match((await h.call('usability_compare_runs', { baselineId: baseline, retestId: baseline }, true)).error, /two different runs/);
    assert.equal(h.fixture.mutations(), 0);
  } finally { await h.close(); }
});

test('saving a plan returns advisory task review without rewriting it', async () => {
  const h = await harness();
  try {
    const plan = { name: 'Ledger', target: h.fixture.url, answers: { purpose: 'Accounting', audience: 'Owners', priority: 'Pricing', success: 'Price visible', boundaries: 'Read only' },
      personas: [{ id: 'owner', context: 'Small business owner' }],
      journeys: [{ id: 'price', personaIds: ['owner'], scenario: 'Price check.', goal: 'Click Options in the menu and read the price.', successCriteria: ['Understands pricing'] }] };
    const saved = await h.call('usability_save_project', plan);
    assert(saved.taskReview.warnings.length >= 3); assert.match(saved.taskReview.instructions, /Never silently rewrite/);
    assert.equal(saved.profile.plan.journeys[0].goal, plan.journeys[0]!.goal);
    const approved = await h.call('usability_approve_project', { projectId: saved.profile.id, ownerApproved: true });
    assert(approved.taskReview.warnings.length >= 3);
    const resource = await h.state.client.readResource({ uri: 'usability://methodology' });
    assert.equal(JSON.parse((resource.contents[0] as { text: string }).text).principles.length, PRINCIPLES.length);
  } finally { await h.close(); }
});
