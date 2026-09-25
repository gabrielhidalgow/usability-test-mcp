import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRINCIPLES, principleIdsSchema, principleChecklist, METHODOLOGY_VERSION } from '../../src/methodology/principles.js';

test('methodology principles are unique, sourced, bounded and never numeric thresholds', () => {
  const ids = PRINCIPLES.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(METHODOLOGY_VERSION, /^\d{4}\.\d{2}-\d+$/);
  for (const p of PRINCIPLES) {
    assert(p.sources.length > 0 && p.sources.every(s => s.startsWith('https://')), `${p.id} needs source links`);
    assert(p.limits.length > 20 && p.lookFor.length > 20 && p.counterexamples.length > 10, `${p.id} needs evidence, counterexamples and limits`);
    // Numeric claims about memory or choice may be discussed in limits, never used as a check.
    assert(!/\b\d+\s*(±|\+\/-|items|options|seconds|chunks)/i.test(p.lookFor), `${p.id} lookFor must not set numeric thresholds`);
  }
  for (const source of ['krug-dmmt', 'krug-rsme', 'weinschenk']) assert(PRINCIPLES.some(p => p.source === source));
  for (const p of PRINCIPLES.filter(p => p.source === 'weinschenk')) assert.match((p as { verification?: string }).verification ?? '', /checked against|outline only|verified/i, `${p.id} must say how its Weinschenk attribution was checked`);
  assert(PRINCIPLES.some(p => p.id === 'progressive-disclosure') && PRINCIPLES.some(p => p.id === 'motion-distraction'));
  assert(principleIdsSchema.safeParse(['orientation', 'feedback']).success);
  assert(!principleIdsSchema.safeParse(['invented-principle']).success);
  assert(!principleIdsSchema.safeParse(['orientation', 'feedback', 'grouping', 'goodwill', 'self-evident']).success, 'at most four tags');
  assert.match(principleChecklist('ux'), /expectation-match/);
  assert.doesNotMatch(principleChecklist('content'), /recognition-over-recall/);
});
