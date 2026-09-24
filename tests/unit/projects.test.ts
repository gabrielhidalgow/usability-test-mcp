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


test('approved native profiles require a confirmed starting state and remain single-participant', async () => {
  const root=await mkdtemp(join(tmpdir(),'native-profile-'));
  try {
    const profiles=new ProjectProfiles(root);
    const draft=await profiles.save({name:'Native fixture',platform:'native',target:'com.example.fixture',native:{deviceId:'emulator-5554',os:'android',preparedTestDevice:true},answers:{purpose:'Fixture',audience:'Visitor',priority:'Read',success:'Visible text',boundaries:'Sandbox only'},personas:[{id:'visitor',context:'Visitor'},{id:'another',context:'Another visitor'}],journeys:[{id:'read',personaIds:['visitor','another'],scenario:'First use',goal:'Read the welcome screen',successCriteria:['Welcome text visible']}]});
    const approved=await profiles.approve(draft.id);
    assert.throws(()=>projectRun(approved,'read',1),/starting state/);
    const run=projectRun(approved,'read',1,{startingStateConfirmed:true});
    assert.equal(run.input.platform,'native');assert.equal(run.input.accessibilityChecks,false);
    assert.throws(()=>projectRun(approved,'read',2,{startingStateConfirmed:true}),/one participant/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('journeys select stable profile IDs, not names or array position; ambiguous legacy plans stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assignments-'));
  try {
    const store = new ProjectProfiles(root);
    const plan = { name: 'Flooring', target: 'https://example.com', answers: { purpose: 'Flooring', audience: 'Installers and specifiers', priority: 'Data sheets', success: 'Visible entry', boundaries: 'Read only' },
      personas: [{ id: 'specifier', name: 'Visitor', context: 'A specifier' }, { id: 'installer', name: 'Visitor', context: 'An installer' }],
      journeys: [{ id: 'data-sheet', personaIds: ['installer'], scenario: 'On site', goal: 'Find a data sheet entry', successCriteria: ['Entry visible'] }] };
    const draft = await store.save(plan); const approved = await store.approve(draft.id);
    const run = projectRun(approved, 'data-sheet', 1);
    assert.equal(run.kind, 'session');
    if (run.kind === 'session') assert.equal(run.input.persona.id, 'installer');
    assert.deepEqual(run.assignment.participants, [{ id: 'installer', name: 'Visitor' }]);
    assert.throws(() => projectRun(approved, 'data-sheet', 2), /assigned persona/);
    await assert.rejects(store.save({ ...plan, journeys: [{ ...plan.journeys[0], personaIds: ['missing'] }] }));
    await assert.rejects(store.save({ ...plan, personas: [plan.personas[0], plan.personas[0]] }));
    await assert.rejects(store.save({ ...plan, journeys: [{ ...plan.journeys[0], personaIds: ['installer', 'installer'] }] }));
    const legacy = { ...approved, plan: { ...approved.plan, journeys: approved.plan.journeys.map(j => ({ ...j, personaIds: undefined })) } };
    assert.throws(() => projectRun(legacy, 'data-sheet', 1), /no participant assignment/);
    const comparison = await store.save({ ...plan, journeys: [{ ...plan.journeys[0], personaIds: ['installer', 'specifier'] }] });
    const round = projectRun(await store.approve(comparison.id), 'data-sheet', 2);
    if (round.kind !== 'round') assert.fail('Expected round');
    assert.deepEqual(round.input.personas?.map(p => p.id), ['installer', 'specifier']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
