import { safeLocation } from './safety.js';
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionInput } from '../config/schema.js';
import { artifactIdSchema, type EvidenceRecorder } from '../evidence/recorder.js';
import type { UsabilityReport } from './types.js';

type Input = Pick<SessionInput, 'target' | 'platform' | 'goal' | 'scenario' | 'rerun'> & Record<string, unknown>;
// A correction replaces a whole run. It never pools different audience tasks or adds a participant.
export class RunCorrections {
  constructor(private recorder: EvidenceRecorder) {}
  async refresh(report: UsabilityReport) { return this.recorder.provenance(report); }
  async validate(kind: 'session' | 'round', input: Input) {
    if (!input.rerun) return;
    const id = input.rerun.priorRunId;
    const report = JSON.parse(await this.recorder.read(id, 'json')) as UsabilityReport;
    const prior = JSON.parse(await this.recorder.read(id, 'journey'));
    if (report.supersededBy) throw new Error(`This run is already superseded by ${report.supersededBy}. Use the latest attempt.`);
    if (!prior.input || (kind === 'session' ? !prior.finishedAt : prior.status === 'running')) throw new Error('Finish or cancel the previous run before replacing it.');
    if (report.kind !== kind || report.target !== (input.platform === 'web' ? safeLocation(input.target) : input.target) || (report.platform ?? 'web') !== input.platform || report.goal !== input.goal || report.scenario !== input.scenario) throw new Error('Corrections must keep the same run type, product, scenario and goal. Different tasks are separate tests, not replacements.');
    if ((report.exercise ?? 'task') !== ((input as { exercise?: string }).exercise ?? 'task')) throw new Error('A correction must keep the same exercise type; first-impression exercises and task journeys are separate tests.');
    if (prior.continuation) throw new Error('A continuation is a linked journey segment. Start a separate test rather than replacing only a segment.');
    // Do not leave a parent comparison silently counting an invalid child attempt.
    if (kind === 'session') {
      let ids: string[] = [];
      try { ids = await readdir(join(this.recorder.root, 'rounds')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const roundId of ids.filter(id => artifactIdSchema.safeParse(id).success)) {
        let round;
        try { round = JSON.parse(await this.recorder.read(roundId, 'journey')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        if (round.sessionIds?.includes(id)) throw new Error(`This session belongs to ${roundId}. Correct and rerun the whole round so participant counts and reviews remain consistent.`);
      }
      let sessions: string[] = [];
      try { sessions = await readdir(join(this.recorder.root, 'sessions')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      for (const sessionId of sessions.filter(id => artifactIdSchema.safeParse(id).success && id.startsWith('session-'))) {
        let record;
        try { record = JSON.parse(await this.recorder.read(sessionId, 'journey')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        if (record.continuation?.rootSessionId === id) throw new Error('This run has continuation segments. Start a separate test rather than replacing only part of a journey.');
      }
    }
  }
  async record(id: string, input: Input) {
    if (!input.rerun) return;
    const priorId = input.rerun.priorRunId;
    const prior = JSON.parse(await this.recorder.read(priorId, 'journey'));
    const changedFields = ['persona', 'personas', 'participantCount', 'contextCheck', 'handoff', 'viewport', 'presentation', 'allowedCapabilities', 'testEnvironment', 'maxActions', 'timeoutMs', 'accessibilityChecks', 'exercise'].filter(key => JSON.stringify(key === 'exercise' ? prior.input[key] ?? 'task' : prior.input[key]) !== JSON.stringify(input[key]));
    const correction = { ...input.rerun, recordedAt: new Date().toISOString(), changedFields };
    await this.recorder.json(join(this.recorder.paths(id).directory, 'correction.json'), correction);
    // Exclusive claim prevents two simultaneous replacements. The sidecar is durable before browser work.
    const marker = join(this.recorder.paths(priorId).directory, 'superseded.json');
    try { await writeFile(marker, JSON.stringify({ supersededBy: id }) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      await unlink(join(this.recorder.paths(id).directory, 'correction.json'));
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another replacement already claimed this run. Inspect the latest saved report.');
      throw error;
    }
    // Refresh human-readable reports too. Raw journey/screenshots stay intact in the appendix.
    const old = JSON.parse(await readFile(this.recorder.paths(priorId).json, 'utf8')) as UsabilityReport;
    await this.recorder.finish(old);
    for (const sessionId of prior.sessionIds ?? []) {
      await this.recorder.json(join(this.recorder.paths(sessionId).directory, 'superseded.json'), { supersededBy: id });
      const child = JSON.parse(await readFile(this.recorder.paths(sessionId).json, 'utf8')) as UsabilityReport;
      await this.recorder.finish(child);
    }
  }
}
