import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceRecorder } from '../../src/evidence/recorder.js';
import { RunCorrections } from '../../src/core/run-corrections.js';
import { ComparisonReviews, initializeComparison } from '../../src/core/comparison.js';
import { sessionInputSchema, roundInputSchema } from '../../src/config/schema.js';
import { sessionReport, synthesizeReports } from '../../src/core/synthesis.js';
import type { SessionRecord } from '../../src/core/types.js';

test('whole-round corrections archive child attempts, reject stale reviews and prevent competing replacements', async () => {
  const root = await mkdtemp(join(tmpdir(), 'round-corrections-')); const recorder = new EvidenceRecorder(root);
  try {
    const reports = [];
    const input = roundInputSchema.parse({ target: 'https://example.com/', scenario: 'Read product information', goal: 'Find a plan', participantCount: 3 });
    for (let i=0;i<3;i++) {
      const { id } = await recorder.create('session');
      const { participantCount: _count, personaContext: _personaContext, personas: _personas, ...shared } = input;
      const record: SessionRecord = { id, kind: 'session', input: sessionInputSchema.parse({ ...shared, persona: {name:'Same display name', context:`Perspective ${i}`} }), provider:'test-double', startedAt:'2026-01-01', finishedAt:'2026-01-01', status:'completed', reason:'Fixture', actions:0, accessibility:[], warnings:[], journey:[] };
      await recorder.checkpoint(record); const report = sessionReport(record, []); await recorder.finish(report); reports.push(report);
    }
    const prior = await recorder.create('round');
    const report = synthesizeReports(reports, prior.id); report.comparison = initializeComparison(report); await recorder.finish(report);
    await recorder.json(prior.paths.journey, {id:prior.id,kind:'round',input,status:'finished',sessionIds:reports.map(r=>r.id)});
    const corrections = new RunCorrections(recorder);
    await assert.rejects(corrections.validate('session', { ...sessionInputSchema.parse({target:input.target,scenario:input.scenario,goal:input.goal,persona:{context:'Corrected'}}), rerun:{priorRunId:reports[0]!.id,reason:'wrong-participant',changes:'Correct profile'} }), /whole round/);
    const replacementInput = {...input,rerun:{priorRunId:prior.id,reason:'wrong-participant' as const,changes:'Use the approved profiles for this task'}};
    await corrections.validate('round', replacementInput);
    const a = await recorder.create('round'); const b = await recorder.create('round');
    const claims = await Promise.allSettled([corrections.record(a.id,replacementInput),corrections.record(b.id,replacementInput)]);
    assert.equal(claims.filter(c=>c.status==='fulfilled').length,1);
    const old = JSON.parse(await recorder.read(prior.id,'json'));
    for (const child of reports) assert.equal(JSON.parse(await recorder.read(child.id,'json')).supersededBy,old.supersededBy);
    await assert.rejects(new ComparisonReviews(recorder).get(prior.id), /superseded/);
    await assert.rejects(new RunCorrections(new EvidenceRecorder(root)).validate('round',replacementInput),/already superseded/);
    assert.match(await recorder.read(prior.id,'details'),/ARCHIVED ATTEMPT/);
    assert(!String(await recorder.read(prior.id,'markdown')).includes('Reported completion'));
    // A cancelled replacement remains a replacement after restart; it does not restore prior completions.
    const replacement = {...report,id:old.supersededBy,sessions:report.sessions.map(s=>({...s,status:'cancelled' as const,reason:'Replacement interrupted'}))};
    await new EvidenceRecorder(root).finish(replacement);
    const saved = JSON.parse(await recorder.read(old.supersededBy,'json')); assert.equal(saved.correction.priorRunId,prior.id);
    assert.match(await recorder.read(old.supersededBy,'markdown'),/completion in 0 of 3/);
  } finally {await rm(root,{recursive:true,force:true});}
});
