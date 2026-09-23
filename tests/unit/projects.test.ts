import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectProfiles, projectRun } from '../../src/projects/profiles.js';

test('profiles persist, edits need review, and participant inputs exclude owner context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'usability-projects-'));
  try {
    const store = new ProjectProfiles(root);
    assert.deepEqual(await store.list(), []);
    const draft = await store.save({ name: 'Example', target: 'https://example.com',
      answers: { purpose: 'Private business goal', audience: 'Beginners', priority: 'Pricing', success: 'Cost visible', boundaries: 'No purchases' },
      personas: [{ context: 'Comparing products' }],
      journeys: [{ id: 'pricing', scenario: 'Choosing software', goal: 'Find the monthly cost', successCriteria: ['Price displayed'] }],
    });
    assert.throws(() => projectRun(draft, 'pricing', 1), /approve/);
    await store.approve(draft.id);
    const reloaded = await new ProjectProfiles(root).get(draft.id);
    const run = projectRun(reloaded, 'pricing', 1);
    assert.equal(run.kind, 'session');
    const configured = projectRun(reloaded, 'pricing', 1, { timeoutMs: 600000, accessibilityChecks: false, viewport: 'mobile' });
    assert.equal(configured.input.timeoutMs, 600000);
    assert.equal(configured.input.accessibilityChecks, false);
    assert.equal(configured.input.viewport, 'mobile');
    assert.throws(() => projectRun(reloaded, 'pricing', 1, { allowedCapabilities: ['payment'], testEnvironment: true }));
    assert.throws(() => projectRun(reloaded, 'pricing', 1, { timeoutMs: 999999 }));
    assert.equal(run.input.testEnvironment, false);
    assert.deepEqual(run.input.allowedCapabilities, []);
    assert(!JSON.stringify(run.input).includes('Private business goal'));
    assert(!JSON.stringify(run.input).includes('Price displayed'));
    assert.throws(() => projectRun(reloaded, 'pricing', 3), /persona/);
    assert.throws(() => projectRun(reloaded, 'missing', 1), /journey/);
    const edited = await store.save({ ...reloaded.plan, name: 'Updated' });
    assert.notEqual(edited.id, reloaded.id);
    assert.equal(edited.approvedAt, null);
    assert.equal((await store.list()).length, 2);
    await assert.rejects(store.get('../escape'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
