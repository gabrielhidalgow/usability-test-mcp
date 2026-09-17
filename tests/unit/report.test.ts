import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionInputSchema } from '../../src/config/schema.js';
import { sessionReport, severityFor, synthesizeReports } from '../../src/core/synthesis.js';
import { renderMarkdown } from '../../src/reports/markdown.js';
import type { Interpretation, ProductObservation, SessionRecord } from '../../src/core/types.js';
import { makeDecision } from '../fixtures/provider.js';

const observation: ProductObservation = { timestamp: '', location: 'http://localhost/', title: 'Page', visibleText: 'Options',
  viewport: { width: 100, height: 100 }, screenshot: { path: '/artifacts/screenshot.png', mimeType: 'image/png' },
  candidates: [], dialogs: [], semantics: { tree: '', focused: null } };
function session(id: string): SessionRecord {
  return { id, kind: 'session', input: sessionInputSchema.parse({ target: 'http://localhost/', persona: { name: id, context: 'Visitor' }, scenario: 'Visit', goal: 'Plans' }),
    provider: 'test-double', startedAt: '', finishedAt: '', status: 'completed', reason: 'Visible confirmation', actions: 1,
    accessibility: [], warnings: [], journey: [{ step: 1, before: observation,
      decision: makeDecision({ type: 'back' }), result: { ok: true, message: 'Went back' }, after: observation }] };
}
const issue: Interpretation = { title: 'Pricing label unclear', category: 'navigation', stepNumbers: [1],
  likelyUsabilityProblem: 'Label may be hard to recognize', recommendation: 'Clarify label', taskImpact: 'minor-delay', confidence: 'medium' };
test('severity follows task impact and completed tasks cannot be reported as blocked', () => {
  assert.equal(severityFor('blocked'), 'critical'); assert.equal(severityFor('minor-delay'), 'medium');
  assert.equal(sessionReport(session('one'), [{ ...issue, taskImpact: 'blocked' }]).findings[0]?.severity, 'high');
});
test('synthesis preserves individual evidence, recurrence, and distinct categories', () => {
  const a = sessionReport(session('one'), [issue]);
  const b = sessionReport(session('two'), [issue, { ...issue, category: 'comprehension' }]);
  const combined = synthesizeReports([a, b], 'round-test');
  assert.equal(combined.findings.length, 2);
  assert.equal(combined.findings[0]!.evidence.length, 2);
  assert.equal(combined.findings[0]!.participantsAffected.length, 2);
  assert.equal(a.findings[0]!.evidence.length, 1, 'synthesis mutated session report');
});
test('fabricated evidence and safety blocks cannot become product findings', () => {
  assert.equal(sessionReport(session('one'), [{ ...issue, stepNumbers: [99] }]).findings.length, 0);
  const blocked = session('blocked'); blocked.journey[0]!.result.blocked = true;
  assert.equal(sessionReport(blocked, [issue]).findings.length, 0);
});
test('Markdown escapes product content and labels simulated evidence and limitations', () => {
  const report = sessionReport(session('one'), [{ ...issue, title: '<script>alert(1)</script> | malicious' }]);
  const md = renderMarkdown(report, '/artifacts');
  assert(!md.includes('<script>')); assert.match(md, /&lt;script&gt;/);
  assert.match(md, /Simulated commentary/); assert.match(md, /not a WCAG conformance audit/);
  assert.match(md, /Why this may be a usability problem/);
});
