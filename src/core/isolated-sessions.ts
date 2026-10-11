import { join } from 'node:path';
import type { EvidenceRecorder } from '../evidence/recorder.js';
import type { Interpretation, SessionRecord, UsabilityReport } from './types.js';
import { initializeComparison } from './comparison.js';
import { contextQuality } from './context-quality.js';
import { mismatches } from './run-comparison.js';
import { isGroundedChange } from './suggested-change.js';
import { sessionReport, synthesizeReports } from './synthesis.js';

// Participants run in their own processes and submit no findings; the coordinating chat evaluates
// afterwards from saved evidence, and can combine isolated sessions into one comparison round.
export class IsolatedSessionError extends Error {}

async function finishedSession(recorder: EvidenceRecorder, id: string) {
  if (!id.startsWith('session-')) throw new IsolatedSessionError(`${id} is not a session ID.`);
  let record: SessionRecord, report: UsabilityReport;
  try {
    record = JSON.parse(await recorder.read(id, 'journey'));
    report = JSON.parse(await recorder.read(id, 'json'));
  } catch { throw new IsolatedSessionError(`Session ${id} has no saved report yet. Wait for it to finish.`); }
  if (!record.finishedAt) throw new IsolatedSessionError(`Session ${id} has not finished.`);
  if (report.supersededBy) throw new IsolatedSessionError(`Session ${id} was superseded by ${report.supersededBy}; use the replacement.`);
  return { record, report };
}

/** Rebuilds a finished session's report with the coordinator's evidence-linked findings. */
export async function reviewSession(recorder: EvidenceRecorder, sessionId: string, findings: Interpretation[]) {
  const { record } = await finishedSession(recorder, sessionId);
  for (const finding of findings) {
    const steps = record.journey.filter(s => finding.stepNumbers.includes(s.step));
    if (steps.length !== new Set(finding.stepNumbers).size || steps.some(s => !s.result.ok || s.result.blocked)) {
      throw new IsolatedSessionError(`Finding "${finding.title}" must cite existing successful, nonblocked steps.`);
    }
    if (!isGroundedChange(finding.suggestedChange, steps)) throw new IsolatedSessionError(`Finding "${finding.title}": current copy must match visible text in the cited steps; omit replacement otherwise.`);
  }
  await recorder.json(join(recorder.paths(sessionId).directory, 'evaluation.json'), { by: 'coordinator', recordedAt: new Date().toISOString() });
  await recorder.finish(sessionReport(record, findings));
  return JSON.parse(await recorder.read(sessionId, 'json')) as UsabilityReport;
}

/** Turns 2–5 finished single sessions of the same task into a round with the usual review stages. */
export async function combineSessions(recorder: EvidenceRecorder, sessionIds: string[]) {
  if (sessionIds.length < 2 || sessionIds.length > 5 || new Set(sessionIds).size !== sessionIds.length) throw new IsolatedSessionError('Combine 2 to 5 different sessions.');
  const loaded = [];
  for (const id of sessionIds) loaded.push(await finishedSession(recorder, id));
  for (const { record, report } of loaded) {
    if (record.continuation) throw new IsolatedSessionError(`Session ${record.id} is a continuation segment; combine whole sessions only.`);
    if ((report.exercise ?? 'task') !== 'task') throw new IsolatedSessionError(`Session ${record.id} is a first-impression exercise, which is never pooled.`);
  }
  // Different participants are the point; everything else about the task must match.
  for (const { report } of loaded.slice(1)) {
    const differences = mismatches(loaded[0]!.report, report).filter(m => m !== 'different participant profiles');
    if (differences.length) throw new IsolatedSessionError(`Sessions are not the same task (${differences.join('; ')}). Only identical tasks can be compared.`);
  }
  const { id, paths } = await recorder.create('round');
  const reports = loaded.map(({ record, report }) => {
    const base = sessionReport(record, []);
    const isolated = Boolean(report.participantRun?.completed && report.participantRun.canary.passed);
    base.sessions = base.sessions.map(s => ({ ...s, isolatedProcess: isolated && contextQuality({ ...base, participantRun: report.participantRun }, s).firstVisitSupported }));
    return base;
  });
  const round = synthesizeReports(reports, id);
  round.findings = []; // Interpretation happens in the round's participants stage, from the saved journeys.
  round.comparison = initializeComparison(round);
  round.limitations = round.limitations.filter(l => !l.includes('Clustering matches category'));
  round.limitations.push('Combined from separately run sessions. Participant interpretations and specialist reviews happen in the round review stages; any earlier per-session evaluations stay in their own session reports.',
    'Patterns are host interpretations checked for valid evidence references, not independently verified causes. Recurrence is qualitative; shared-model bias may recur across profiles.');
  await recorder.json(paths.journey, { id, kind: 'round', combined: true, sessionIds, status: 'finished' });
  await recorder.finish(round);
  return { roundId: id, sessions: round.sessions.map(s => ({ id: s.id, status: s.status, isolatedProcess: s.isolatedProcess ?? false })) };
}
