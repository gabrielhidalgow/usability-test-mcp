import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionInputSchema } from '../../src/config/schema.js';
import { sessionReport, severityFor, synthesizeReports } from '../../src/core/synthesis.js';
import { renderMarkdown, renderDetailedMarkdown } from '../../src/reports/markdown.js';
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
  const md = renderDetailedMarkdown(report, '/artifacts');
  assert(!md.includes('<script>')); assert.match(md, /&lt;script&gt;/);
  assert.match(md, /Simulated commentary/); assert.match(md, /not a WCAG conformance audit/);
  assert.match(md, /Why this may be a usability problem/);
});


test('executive report bounds actions, links full evidence and shows concrete copy changes', () => {
  const findings = Array.from({ length: 8 }, (_, i) => ({ ...issue, title: `Issue ${i + 1}`, recommendation: `Specific recommendation ${i + 1}`,
    suggestedChange: { kind: 'copy' as const, location: 'Home navigation', proposal: 'Name the destination in the link label.', verify: 'Check that a visitor can locate plan pricing.', replacement: { before: 'Options', after: `Pricing ${i + 1}` } } }));
  const report = sessionReport(session('one'), findings);
  const md = renderMarkdown(report, '/artifacts');
  assert.equal((md.match(/^### /gm) ?? []).length, 5);
  assert.match(md, /Current → proposed:\*\* “Options” → “Pricing 1”/);
  assert.match(md, /Check after the change/);
  assert.match(md, /3 additional action/);
  assert.match(md, /details.md/);
  assert(!md.includes('Simulated commentary'));
  assert(md.split(/\s+/).length < 800);
  const details = renderDetailedMarkdown(report, '/artifacts');
  assert.match(details, /Pricing 8/);
  assert.match(details, /Verify after the change/);
});

test('unsupported current copy is omitted and executive reports keep uncertainty visible', () => {
  const original = session('one'); original.status = 'timeout'; original.reason = 'Session deadline exceeded';
  const report = sessionReport(original, [{ ...issue, suggestedChange: { kind: 'copy', location: 'Home', proposal: 'Use Pricing', verify: 'Find the price', replacement: { before: 'Invented current label', after: 'Pricing' } } }]);
  assert.equal(report.findings[0]!.suggestedChange, undefined);
  const md = renderMarkdown(report, '/artifacts');
  assert.match(md, /timeout/); assert.match(md, /incomplete or inconclusive/);
  assert(!md.includes('Invented current label'));
  assert.match(md, /Automated accessibility was not assessed/);
});

test('report quality distinguishes informed and unknown contexts and withholds first-visit claims', () => {
  const original = session('one');
  original.input.contextCheck = { mode: 'informed-walkthrough', isolation: 'shared', exposure: ['source-code'] };
  original.journey[0]!.decision.contextIsolation = 'host-reported fresh'; // Cannot erase recorded contamination.
  const report = sessionReport(original, []);
  const md = renderMarkdown(report, '/artifacts');
  assert.match(md, /How to interpret this test/); assert.match(md, /informed walkthroughs/); assert.match(md, /First-visit conclusions are withheld/);
  assert.match(renderDetailedMarkdown(report, '/artifacts'), /source-code/);
  const unknown = sessionReport(session('two'), []);
  assert.match(renderMarkdown(unknown, '/artifacts'), /First-visit conclusions are withheld/);
  const fresh = session('three'); fresh.journey[0]!.decision.contextIsolation = 'host-reported fresh';
  assert(!renderMarkdown(sessionReport(fresh, []), '/artifacts').includes('First-visit conclusions are withheld'));
});

test('superseded runs keep an archive but cannot contribute outcomes or recurrence', () => {
  const prior = sessionReport(session('prior'), [issue]); prior.supersededBy = 'replacement';
  const replacement = sessionReport(session('replacement'), [issue]);
  const merged = synthesizeReports([prior, replacement], 'round-current');
  assert.equal(merged.sessions.length, 1); assert.equal(merged.findings[0]!.evidence.length, 1);
  const md = renderMarkdown(prior, '/artifacts');
  assert.match(md, /Superseded attempt/); assert(!md.includes('Reported completion')); assert(!md.includes('Pricing label unclear'));
  assert.match(renderDetailedMarkdown(prior, '/artifacts'), /Pricing label unclear/);
});
