import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { artifactIdSchema, type EvidenceRecorder } from '../evidence/recorder.js';
import { describeAction } from './action-description.js';
import { REVIEW_GUARDRAILS } from '../methodology/principles.js';
import type { UsabilityReport } from './types.js';

const text = z.string().trim().min(1).max(2000);
const reference = z.strictObject({ sessionId: artifactIdSchema, step: z.number().int().positive() });
export const runComparisonSubmissionSchema = z.strictObject({
  baselineId: artifactIdSchema, retestId: artifactIdSchema,
  assessments: z.array(z.strictObject({
    baselineFindingId: z.string().min(1).max(200),
    outcome: z.enum(['observed-again', 'not-observed-on-comparable-path', 'inconclusive']),
    explanation: text, retestEvidence: z.array(reference).max(20).default([]),
  })).max(60),
  newlyObserved: z.array(z.string().min(1).max(200)).max(40).default([]),
});
export type BaselineComparison = {
  baselineId: string; retestId: string; comparable: boolean; mismatches: string[];
  assessments: (z.infer<typeof runComparisonSubmissionSchema>['assessments'][number] & { baselineTitle: string })[];
  newlyObserved: { retestFindingId: string; title: string }[];
  recordedAt: string; revision: number; digest: string;
};
export class RunComparisonError extends Error {}
export const COMPARISON_FILE = 'baseline-comparison.json';

const INSTRUCTIONS = `Compare a baseline run with a retest after changes. Assess EVERY baseline finding exactly once:
observed-again (cite retest steps showing the same obstacle), not-observed-on-comparable-path (cite retest steps where the participant reached the same screen or control without the obstacle), or inconclusive (the retest did not reach that part of the interface, or evidence is unclear).
Absence is not proof of a fix: never write "fixed" or "resolved". List retest finding IDs that were not present in the baseline as newlyObserved.
Participant counts from the two runs are never merged. ${REVIEW_GUARDRAILS}`;

export class RunComparisons {
  constructor(private recorder: EvidenceRecorder) {}
  private async load(id: string, role: 'baseline' | 'retest'): Promise<UsabilityReport> {
    let report: UsabilityReport;
    try { report = JSON.parse(await this.recorder.read(id, 'json')) as UsabilityReport; }
    catch { throw new RunComparisonError(`The ${role} report ${id} is unavailable.`); }
    if (report.supersededBy) throw new RunComparisonError(`The ${role} run was superseded by ${report.supersededBy}. Compare the replacement instead.`);
    if (report.exercise === 'first-impression') throw new RunComparisonError('First-impression exercises have no task outcome and cannot be compared as baseline/retest runs.');
    if (report.comparison?.nextStage === 'participants') throw new RunComparisonError(`Finish the participants review of the ${role} round first; its findings are not interpreted yet.`);
    return report;
  }
  private async pair(baselineId: string, retestId: string) {
    if (baselineId === retestId) throw new RunComparisonError('Choose two different runs.');
    const baseline = await this.load(baselineId, 'baseline');
    const retest = await this.load(retestId, 'retest');
    // A correction replaces an invalid attempt; it is not evidence about a product change.
    if (retest.correction?.priorRunId === baselineId || baseline.correction?.priorRunId === retestId) throw new RunComparisonError('These runs are a correction pair (one supersedes the other), not a baseline and retest.');
    return { baseline, retest, mismatches: mismatches(baseline, retest) };
  }
  async inputs(baselineId: string, retestId: string) {
    const { baseline, retest, mismatches: differences } = await this.pair(baselineId, retestId);
    const findings = (report: UsabilityReport) => report.findings.map(f => ({ id: f.id, title: f.title, category: f.category, severity: f.severity,
      problem: f.likelyUsabilityProblem, principleIds: f.principleIds, evidence: f.evidence.map(e => ({ sessionId: e.sessionId, stepNumbers: e.stepNumbers })) }));
    let existing: BaselineComparison | undefined;
    try { existing = JSON.parse(await readFile(join(this.recorder.paths(retestId).directory, COMPARISON_FILE), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { baselineId, retestId, comparable: !differences.length, mismatches: differences,
      baseline: { goal: baseline.goal, findings: findings(baseline), patterns: baseline.comparison?.patterns.map(p => ({ id: p.id, title: p.title, findingIds: p.findingIds, participantCount: p.participantCount })) },
      retest: { findings: findings(retest), reviewStage: retest.comparison?.nextStage,
        journeys: retest.journeys.map(j => ({ sessionId: j.sessionId, steps: j.steps.map(s => ({ step: s.step, action: describeAction(s),
          result: s.result.message, ok: s.result.ok && !s.result.blocked, before: s.before.title, after: s.after?.title, userExpectation: s.decision.userExpectation })) })) },
      existing,
      instructions: differences.length ? `${INSTRUCTIONS} These runs are NOT comparable (${differences.join('; ')}); only observed-again or inconclusive are allowed.` : INSTRUCTIONS,
      nextTool: 'usability_submit_run_comparison',
      screenshotInstructions: 'Use usability_get_report with format=details for linked screenshots of either run.' };
  }
  async submit(raw: unknown): Promise<BaselineComparison> {
    const submission = runComparisonSubmissionSchema.parse(raw);
    const { baseline, retest, mismatches: differences } = await this.pair(submission.baselineId, submission.retestId);
    const path = join(this.recorder.paths(retest.id).directory, COMPARISON_FILE);
    const digest = createHash('sha256').update(JSON.stringify(submission)).digest('hex');
    let previous: BaselineComparison | undefined;
    try { previous = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (previous?.digest === digest) return previous;
    if (previous && previous.baselineId !== baseline.id) throw new RunComparisonError(`This retest is already compared with ${previous.baselineId}. A retest has one baseline.`);
    const ids = submission.assessments.map(a => a.baselineFindingId);
    if (new Set(ids).size !== ids.length || baseline.findings.some(f => !ids.includes(f.id)) || ids.some(id => !baseline.findings.some(f => f.id === id))) {
      throw new RunComparisonError('Assess every baseline finding exactly once, using its baseline finding ID.');
    }
    for (const a of submission.assessments) {
      if (differences.length && a.outcome === 'not-observed-on-comparable-path') throw new RunComparisonError(`Runs are not comparable (${differences.join('; ')}); use inconclusive instead of not-observed-on-comparable-path.`);
      if (a.outcome !== 'inconclusive' && !a.retestEvidence.length) throw new RunComparisonError(`${a.outcome} requires retest step evidence.`);
      for (const ref of a.retestEvidence) {
        const step = retest.journeys.find(j => j.sessionId === ref.sessionId)?.steps.find(s => s.step === ref.step);
        if (!step || !step.result.ok || step.result.blocked) throw new RunComparisonError('Retest evidence must reference an existing successful, nonblocked retest step.');
      }
    }
    if (new Set(submission.newlyObserved).size !== submission.newlyObserved.length || submission.newlyObserved.some(id => !retest.findings.some(f => f.id === id))) {
      throw new RunComparisonError('newlyObserved must list distinct existing retest finding IDs.');
    }
    const saved: BaselineComparison = { baselineId: baseline.id, retestId: retest.id, comparable: !differences.length, mismatches: differences,
      assessments: submission.assessments.map(a => ({ ...a, baselineTitle: baseline.findings.find(f => f.id === a.baselineFindingId)!.title })),
      newlyObserved: submission.newlyObserved.map(id => ({ retestFindingId: id, title: retest.findings.find(f => f.id === id)!.title })),
      recordedAt: new Date().toISOString(), revision: (previous?.revision ?? 0) + 1, digest };
    await this.recorder.json(path, saved);
    await this.recorder.finish(retest); // Refresh report.md/details.md with the comparison.
    return saved;
  }
}

function personaKey(report: UsabilityReport): string {
  return JSON.stringify(report.sessions.filter(s => !s.continuation).map(s => s.persona.id ?? s.persona.context).sort());
}
function origin(target: string): string { try { return new URL(target).origin; } catch { return target; } }
export function mismatches(baseline: UsabilityReport, retest: UsabilityReport): string[] {
  const out: string[] = [];
  const count = (r: UsabilityReport) => new Set(r.sessions.map(s => s.continuation?.rootSessionId ?? s.id)).size;
  if (baseline.kind !== retest.kind) out.push(`run type ${baseline.kind} vs ${retest.kind}`);
  if (origin(baseline.target) !== origin(retest.target)) out.push('different product origin');
  if (baseline.scenario !== retest.scenario) out.push('different scenario');
  if (baseline.goal !== retest.goal) out.push('different goal');
  if ((baseline.platform ?? 'web') !== (retest.platform ?? 'web')) out.push('different platform');
  if (baseline.viewport !== retest.viewport) out.push(`viewport ${baseline.viewport ?? 'unknown'} vs ${retest.viewport ?? 'unknown'}`);
  const focusKey = (r: UsabilityReport) => JSON.stringify(r.focus ? { name: r.focus.name, startPath: r.focus.startPath, includePaths: [...r.focus.includePaths].sort() } : null);
  if (focusKey(baseline) !== focusKey(retest)) out.push(`different focus area (${baseline.focus?.name ?? 'none'} vs ${retest.focus?.name ?? 'none'})`);
  if (count(baseline) !== count(retest)) out.push(`participant count ${count(baseline)} vs ${count(retest)}`);
  else if (personaKey(baseline) !== personaKey(retest)) out.push('different participant profiles');
  return out;
}
