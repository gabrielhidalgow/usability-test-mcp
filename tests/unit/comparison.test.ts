import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceRecorder } from '../../src/evidence/recorder.js';
import { ComparisonReviews, initializeComparison } from '../../src/core/comparison.js';
import { sessionReport, synthesizeReports } from '../../src/core/synthesis.js';
import { sessionInputSchema } from '../../src/config/schema.js';
import type { SessionRecord, ProductObservation, Interpretation } from '../../src/core/types.js';
import { makeDecision } from '../fixtures/provider.js';

const observation: ProductObservation = { timestamp: '', location: 'http://localhost/', title: 'Home', visibleText: 'Options',
  viewport: { width: 100, height: 100 }, screenshot: { path: '/fixture.png', mimeType: 'image/png' }, candidates: [], dialogs: [], semantics: { tree: '', focused: null } };
const issue: Interpretation = { title: 'Unclear label', category: 'navigation', stepNumbers: [1], likelyUsabilityProblem: 'Ambiguous destination', recommendation: 'Clarify', taskImpact: 'minor-delay', confidence: 'medium' };
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'comparison-unit-')); const recorder = new EvidenceRecorder(root);
  const sessions: SessionRecord[] = [];
  for (let i = 0; i < 3; i++) {
    const { id } = await recorder.create('session');
    const record: SessionRecord = { id, kind: 'session', input: sessionInputSchema.parse({ target: 'http://localhost/', persona: { name: 'Same name', context: 'Visitor' }, scenario: 'Visit', goal: 'Plans' }),
      provider: 'unit-test-double', startedAt: '', finishedAt: 'finished', status: i === 2 ? 'timeout' : 'completed', reason: 'Fixture', actions: 1, accessibility: [], warnings: [],
      journey: [{ step: 1, before: observation, decision: makeDecision({ type: 'scroll', direction: 'down' }), result: { ok: true, message: 'Scrolled' }, after: observation },
        { step: 2, before: observation, decision: makeDecision({ type: 'back' }), result: { ok: false, blocked: true, message: 'Policy blocked' } }] };
    sessions.push(record); await recorder.checkpoint(record);
  }
  const { id } = await recorder.create('round');
  const report = synthesizeReports(sessions.map(s => sessionReport(s, [])), id);
  report.comparison = initializeComparison(report); await recorder.finish(report);
  return { root, recorder, id, sessions, report, reviews: new ComparisonReviews(recorder) };
}

test('review rejects invalid evidence and stale changes while preserving pending base report', async () => {
  const f = await setup();
  try {
    for (const step of [99, 2]) {
      await assert.rejects(f.reviews.submit(f.id, 0, { stage: 'participants', sessions: f.sessions.map(s => ({ sessionId: s.id, findings: [{ ...issue, stepNumbers: [step] }] })) }), /existing successful/);
      assert.equal((await f.reviews.get(f.id)).revision, 0);
    }
    const submission = { stage: 'participants', sessions: f.sessions.map((s,i) => ({ sessionId: s.id, findings: i < 2 ? [{ ...issue, title: i ? 'Different wording' : issue.title }, ...(i === 0 ? [{ ...issue, title: 'Unrelated paragraph', category: 'content' }] : [])] : [] })) };
    let result = await f.reviews.submit(f.id, 0, submission);
    assert.equal(result.report.findings.length, 3);
    await assert.rejects(f.reviews.submit(f.id, 0, { ...submission, sessions: [] }));
    const ids = result.report.findings.filter(x => x.category === 'navigation').map(x => x.id);
    const group = { title: 'Common obstacle', screenOrControl: 'Home Options', obstacle: 'Label ambiguous', findingIds: ids, recommendation: 'Clarify',
      assessments: f.sessions.map((s,i) => ({ participantId: s.id, status: i < 2 ? 'experienced' : 'inconclusive', explanation: i < 2 ? 'Observed in recorded step' : 'Timed out; cannot conclude', evidence: i < 2 ? [{ sessionId: s.id, step: 1 }] : [] })) };
    const invalid = structuredClone(group); invalid.assessments[0]!.evidence[0]!.sessionId = f.sessions[1]!.id;
    await assert.rejects(f.reviews.submit(f.id, 1, { stage: 'synthesis', patterns: [invalid] }), /another participant/);
    assert.equal((await f.reviews.get(f.id)).report.comparison.ungroupedFindingIds.length, 3);
    result = await f.reviews.submit(f.id, 1, { stage: 'synthesis', patterns: [group] });
    assert.equal(result.report.comparison.patterns[0]!.participantCount, 2, 'Duplicate names must not collapse participants');
    assert.equal(result.report.comparison.ungroupedFindingIds.length, 1, 'Unrelated issue stays separate');
    assert.equal(result.report.comparison.reviews.ux.status, 'pending');
    const restarted = new ComparisonReviews(f.recorder);
    assert.equal((await restarted.get(f.id)).stage, 'ux');
    await assert.rejects(restarted.submit(f.id, 2, { stage: 'ux', notes: [{ title: 'Invalid', observation: 'Tool error', recommendation: 'Fix', evidence: [{ sessionId: f.sessions[0]!.id, step: 2 }] }] }), /existing successful/);
    const md = await f.recorder.read(f.id, 'markdown');
    assert.match(md, /inconclusive/); assert.match(md, /timeout/); assert.match(md, /pending/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('continuation roots count once and unknown profile/isolation remain explicit', async () => {
  const f = await setup();
  try {
    const [first, second] = f.report.sessions;
    second!.continuation = { previousSessionId: first!.id, rootSessionId: first!.id, previousStatus: 'timeout', browserStateRestored: false, uncertainAction: false };
    const comparison = initializeComparison(f.report);
    assert.equal(comparison.participants.length, 2);
    assert.equal(comparison.participants[0]!.sessionIds.length, 2);
    assert.equal(comparison.participants[0]!.basis, 'unspecified');
    assert.equal(comparison.participants[0]!.contextIsolation, 'unknown');
    f.report.journeys[0]!.steps[0]!.decision.contextIsolation = 'host-reported fresh';
    f.report.journeys[1]!.steps[0]!.decision.contextIsolation = 'shared';
    assert.equal(initializeComparison(f.report).participants[0]!.contextIsolation, 'shared');
    f.report.comparison = comparison; await f.recorder.finish(f.report);
    let review = await f.reviews.submit(f.id, 0, { stage: 'participants', sessions: f.sessions.map((s,i) => ({ sessionId: s.id, findings: i < 2 ? [issue] : [] })) });
    review = await f.reviews.submit(f.id, 1, { stage: 'synthesis', patterns: [{ title: 'Repeated within continuation', screenOrControl: 'Options', obstacle: 'Ambiguous', recommendation: 'Clarify', findingIds: review.report.findings.map(f => f.id), assessments: [
      { participantId: first!.id, status: 'experienced', explanation: 'Two segments of one participant', evidence: [{ sessionId: first!.id, step: 1 }, { sessionId: second!.id, step: 1 }] },
      { participantId: f.sessions[2]!.id, status: 'not-observed', explanation: 'Relevant interface not assessed', evidence: [] },
    ] }] });
    assert.equal(review.report.comparison.patterns[0]!.participantCount, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
