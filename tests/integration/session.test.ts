import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceRecorder } from '../../src/evidence/recorder.js';
import { SessionOrchestrator } from '../../src/core/session-orchestrator.js';
import { PlaywrightProductDriver } from '../../src/drivers/playwright/driver.js';
import { startFixture } from '../fixtures/site.js';
import { FixtureProvider, makeDecision } from '../fixtures/provider.js';

export const fixtureInput = (target: string) => ({ target, persona: { name: 'Alex', context: 'Small business owner' },
  scenario: 'You are looking for simple accounting software.', goal: 'Find the monthly price and reach workspace setup.',
  maxActions: 10, timeoutMs: 30000 });

test('one participant navigates iteratively, stores screenshots and produces axe and evidence-linked reports', async () => {
  const fixture = await startFixture();
  const root = await mkdtemp(join(tmpdir(), 'usability-session-'));
  try {
    const runner = new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver());
    const run = await runner.run(fixtureInput(fixture.url), new FixtureProvider());
    assert.equal(run.session.status, 'completed', run.session.reason);
    assert.equal(run.session.actions, 2);
    assert.equal(run.session.journey.length, 3);
    assert.equal(run.report.findings[0]?.evidence[0]?.stepNumbers[0], 1);
    assert.equal(run.session.accessibility.length, 3);
    assert(run.session.accessibility[0]?.findings.some(f => f.id === 'image-alt'));
    assert(!run.session.initialObservation?.visibleText.includes('HIDDEN_ROUTE_SECRET'));
    assert(!run.session.initialObservation?.visibleText.includes('OFFSCREEN_SECRET'));
    assert(run.session.initialObservation?.visibleText.includes('First visit'));
    for (const step of run.session.journey) {
      const png = await readFile(step.before.screenshot.path);
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      if (step.after) assert((await stat(step.after.screenshot.path)).size > 100);
    }
    const md = await readFile(run.paths.report, 'utf8');
    assert.match(md, /synthetic participants/);
    assert.match(md, /Observed behaviour/);
    assert.match(md, /Why this may be a usability problem/);
    assert.doesNotMatch(md, /overall usability score/i);
    assert.equal(JSON.parse(await readFile(run.paths.journey, 'utf8')).status, 'completed');
    assert.equal(fixture.mutations(), 0);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('unapproved POST is blocked even when a button label looks harmless', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'usability-safety-'));
  try {
    const provider = new FixtureProvider();
    provider.decideNextAction = async ({ observation }) => makeDecision({ type: 'click',
      target: observation.candidates.find(c => c.name === 'Ping')!.ref, capability: null });
    const run = await new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver())
      .run({ ...fixtureInput(fixture.url + '/safety'), accessibilityChecks: false }, provider);
    assert.equal(run.session.status, 'blocked');
    assert.equal(fixture.mutations(), 0);
    assert.equal(run.report.findings.length, 0);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('keyboard-only journey uses fresh browser focus and records every key', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'usability-keys-'));
  try {
    const runner = new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver());
    const run = await runner.run({ ...fixtureInput(fixture.url), interactionMode: 'keyboard', accessibilityChecks: false }, new FixtureProvider());
    assert.equal(run.session.status, 'completed', run.session.reason);
    assert(run.session.journey.some(s => s.before.semantics.focused?.includes('Options')));
    assert(run.session.journey.every(s => ['key', 'finish'].includes(s.decision.selectedAction.type)));
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('redirects cannot escape the permitted origin, while same-origin redirects work', async () => {
  const fixture = await startFixture(); const other = await startFixture();
  const root = await mkdtemp(join(tmpdir(), 'usability-redirect-'));
  try {
    const runner = new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver());
    const blocked = await runner.run({ ...fixtureInput(`${fixture.url}/redirect?to=${encodeURIComponent(other.url)}`), accessibilityChecks: false }, new FixtureProvider());
    assert.equal(blocked.session.status, 'error');
    assert.equal(other.reads(), 0, 'Cross-origin redirect made a request before policy validation');
    const permitted = await runner.run({ ...fixtureInput(fixture.url + '/redirect'), accessibilityChecks: false }, new FixtureProvider());
    assert.equal(permitted.session.status, 'completed', permitted.session.reason);
  } finally { await fixture.close(); await other.close(); await rm(root, { recursive: true, force: true }); }
});


test('slow document navigation is observed without replaying the click', async () => {
  let destinationReads = 0;
  const site = createServer(async (request, response) => {
    if (request.url === '/article') { destinationReads++; await delay(6000); }
    response.setHeader('Content-Type', 'text/html');
    response.end(request.url === '/article' ? '<h1>Explanation available</h1>' : '<a href="/article">Read explanation</a>');
  });
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  assert(address && typeof address !== 'string');
  const root = await mkdtemp(join(tmpdir(), 'usability-slow-navigation-'));
  try {
    const provider = new FixtureProvider();
    provider.decideNextAction = async ({ observation }) => observation.visibleText.includes('Explanation available')
      ? makeDecision({ type: 'finish', outcome: 'completed', reason: 'Explanation reached', visibleEvidence: 'Explanation available' })
      : makeDecision({ type: 'click', target: observation.candidates.find(c => c.name === 'Read explanation')!.ref, capability: null });
    provider.evaluateObservation = async () => [];
    const run = await new SessionOrchestrator(new EvidenceRecorder(root), () => new PlaywrightProductDriver())
      .run({ ...fixtureInput(`http://127.0.0.1:${address.port}`), accessibilityChecks: false }, provider);
    assert.equal(run.session.status, 'completed', run.session.reason);
    assert.equal(run.session.journey[0]?.result.ok, true);
    assert.equal(destinationReads, 1);
  } finally { await new Promise<void>(resolve => site.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
