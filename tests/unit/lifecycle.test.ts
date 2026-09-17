import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProductDriver } from '../../src/drivers/product-driver.js';
import type { ProductObservation } from '../../src/core/types.js';
import { SessionOrchestrator } from '../../src/core/session-orchestrator.js';
import { EvidenceRecorder } from '../../src/evidence/recorder.js';
import { FixtureProvider, makeDecision } from '../fixtures/provider.js';

function stubDriver() {
  let stops = 0; let actions = 0;
  const observation: ProductObservation = { timestamp: '', title: 'Fake page', location: 'http://localhost/', visibleText: 'Fake page',
    viewport: { width: 100, height: 100 }, screenshot: { path: '/fake/screenshot.png', mimeType: 'image/png' },
    candidates: [], dialogs: [], semantics: { tree: '', focused: null } };
  const act = async () => { actions++; return { ok: true, message: 'Test action executed' }; };
  const driver: ProductDriver = { kind: 'web', start: async () => {}, stop: async () => { stops++; },
    getObservation: async () => observation, click: act, tap: act, type: act, scroll: act, pressKey: act, goBack: act,
    screenshot: async () => observation.screenshot, getAccessibilitySnapshot: async () => observation.semantics,
    getCurrentLocation: async () => observation.location, scanAccessibility: async (step, screenshot) => ({ step, screenshot, findings: [] }),
    setActionCapability: () => {},
  };
  return { driver, stops: () => stops, actions: () => actions };
}
const input = { target: 'http://localhost/', persona: { context: 'Visitor' }, scenario: 'Explore', goal: 'Find something', accessibilityChecks: false };

test('action limit is exact, unfinished output is persisted, and browser cleanup runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'usability-limit-')); const stub = stubDriver();
  const provider = new FixtureProvider();
  provider.decideNextAction = async () => makeDecision({ type: 'scroll', direction: 'down' });
  try {
    const result = await new SessionOrchestrator(new EvidenceRecorder(root), () => stub.driver).run({ ...input, maxActions: 2 }, provider);
    assert.equal(stub.actions(), 2); assert.equal(stub.stops(), 1);
    assert.equal(result.session.status, 'incomplete');
    assert.match(result.session.reason, /action limit/);
    assert.equal(JSON.parse(await readFile(result.paths.journey, 'utf8')).actions, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('deadline cancels a hung provider and retains partial evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'usability-timeout-')); const stub = stubDriver();
  const provider = new FixtureProvider(); provider.decideNextAction = () => new Promise(() => {});
  try {
    const result = await new SessionOrchestrator(new EvidenceRecorder(root), () => stub.driver).run({ ...input, timeoutMs: 1000 }, provider);
    assert.equal(result.session.status, 'timeout'); assert.equal(stub.stops(), 1);
    assert(result.session.initialObservation);
    assert.equal(JSON.parse(await readFile(result.paths.json, 'utf8')).sessions[0].status, 'timeout');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('caller cancellation and startup failure produce distinct outcomes with cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'usability-cancel-'));
  try {
    const stub = stubDriver(); const controller = new AbortController(); controller.abort();
    const runner = new SessionOrchestrator(new EvidenceRecorder(root), () => stub.driver);
    const cancelled = await runner.run(input, new FixtureProvider(), controller.signal);
    assert.equal(cancelled.session.status, 'cancelled');
    stub.driver.start = async () => { throw new Error('private backend details sk-should-not-leak'); };
    const failed = await runner.run(input, new FixtureProvider());
    assert.equal(failed.session.status, 'error'); assert.equal(stub.stops(), 2);
    assert(!(await readFile(failed.paths.json, 'utf8')).includes('sk-should-not-leak'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
