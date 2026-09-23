import { createHash } from 'node:crypto';
import { z } from 'zod';
import { EvidenceRecorder, artifactIdSchema } from '../evidence/recorder.js';
import { interpretationSchema, type UsabilityReport, type SessionRecord } from './types.js';
import { sessionReport } from './synthesis.js';

const text = z.string().trim().min(1).max(2000);
const reference = z.strictObject({ sessionId: artifactIdSchema, step: z.number().int().positive() });
const assessment = z.strictObject({ participantId: artifactIdSchema,
  status: z.enum(['experienced', 'successful', 'not-observed', 'inconclusive']),
  explanation: text, evidence: z.array(reference).max(20) });
const pattern = z.strictObject({ title: text, screenOrControl: text, obstacle: text,
  findingIds: z.array(z.string().min(1)).min(1).max(40), recommendation: text,
  assessments: z.array(assessment).min(1).max(5) });
const expertNote = z.strictObject({ title: text, observation: text, recommendation: text,
  evidence: z.array(reference).min(1).max(20) });
export const reviewSubmissionSchema = z.discriminatedUnion('stage', [
  z.strictObject({ stage: z.literal('participants'), sessions: z.array(z.strictObject({
    sessionId: artifactIdSchema, findings: z.array(interpretationSchema).max(8),
  })).min(1).max(5) }),
  z.strictObject({ stage: z.literal('synthesis'), patterns: z.array(pattern).max(40) }),
  z.strictObject({ stage: z.literal('ux'), notes: z.array(expertNote).max(8) }),
  z.strictObject({ stage: z.literal('content'), notes: z.array(expertNote).max(8) }),
]);
type Pattern = z.infer<typeof pattern> & { id: string; participantCount: number; severity: string };
export type Comparison = {
  revision: number; nextStage: 'participants' | 'synthesis' | 'ux' | 'content' | 'complete';
  participants: { participantId: string; sessionIds: string[]; name: string;
    basis: string; contextIsolation: 'shared' | 'host-reported fresh' | 'unknown' }[];
  patterns: Pattern[]; ungroupedFindingIds: string[];
  reviews: { ux: { status: 'pending' | 'complete'; notes: z.infer<typeof expertNote>[] };
    content: { status: 'pending' | 'complete'; notes: z.infer<typeof expertNote>[] } };
  lastSubmission?: string;
};
export function initializeComparison(report: UsabilityReport): Comparison {
  const participants: Comparison['participants'] = [];
  for (const session of report.sessions) {
    const participantId = session.continuation?.rootSessionId ?? session.id;
    const declarations = report.journeys.find(j => j.sessionId === session.id)?.steps.map(s => s.decision.contextIsolation) ?? [];
    const isolation = declarations.includes('shared') ? 'shared' : declarations[0] === 'host-reported fresh' ? 'host-reported fresh' : 'unknown';
    const prior = participants.find(p => p.participantId === participantId);
    if (prior) {
      prior.sessionIds.push(session.id);
      if (isolation === 'shared' || prior.contextIsolation === 'shared') prior.contextIsolation = 'shared';
      else if (isolation !== prior.contextIsolation) prior.contextIsolation = 'unknown';
    }
    else participants.push({ participantId, sessionIds: [session.id], name: session.persona.name,
      basis: session.persona.basis ?? 'unspecified', contextIsolation: isolation });
  }
  return { revision: 0, nextStage: 'participants', participants, patterns: [], ungroupedFindingIds: [],
    reviews: { ux: { status: 'pending', notes: [] }, content: { status: 'pending', notes: [] } } };
}
export class ReviewError extends Error {}
const instructions = {
  participants: 'All journeys are finished. Interpret each participant independently from recorded evidence. Submit one entry per session, including empty findings. Cite only successful, nonblocked steps. Tool errors, action limits and safety blocks are not product issues. Do not infer emotions or disabilities. Existing individual findings will be preserved.',
  synthesis: 'Group findings only when the visible screen/control, obstacle and task impact describe the same issue. Titles need not match. Include one assessment per stable participant ID: experienced, successful on the relevant interface, not-observed, or inconclusive. Cite evidence for experienced/successful. Not-observed is not proof of absence. Retain contradictory evidence. Do not merge unrelated obstacles or force consensus; omit doubtful groups to keep their findings ungrouped. No percentages or statistical claims.',
  ux: 'Act as a post-run UX reviewer. Inspect saved screenshots and journeys. Submit evidence-linked UX recommendations, including successful patterns worth preserving. These are expert interpretations, not additional participant observations. Empty notes are valid. Do not infer human emotions, timing, or outcomes from tool failures.',
  content: 'Act as a separate post-run content reviewer. Inspect visible wording and recorded journeys for terminology, clarity, information gaps and helpful content. Cite screenshot/step evidence. Do not invent missing content, emotions or domain facts. These are expert interpretations, not participant observations. Empty notes are valid.',
  complete: 'Review complete. Report qualitative patterns, successful paths, conflicting/inconclusive evidence, specialist recommendations, and context/profile limitations. These are synthetic journeys, not independent human research.',
};
export class ComparisonReviews {
  private busy = new Set<string>();
  constructor(private recorder: EvidenceRecorder) {}
  private async load(id: string): Promise<UsabilityReport & { comparison: Comparison }> {
    const report = JSON.parse(await this.recorder.read(id, 'json')) as UsabilityReport;
    if (report.kind !== 'round' || !report.comparison) throw new ReviewError('This report has no comparison workflow. Run a new web round.');
    return report as UsabilityReport & { comparison: Comparison };
  }
  async get(id: string) {
    const report = await this.load(id);
    return { id, revision: report.comparison.revision, stage: report.comparison.nextStage,
      instructions: instructions[report.comparison.nextStage], report,
      nextTool: report.comparison.nextStage === 'complete' ? 'usability_get_report' : 'usability_submit_review',
      screenshotInstructions: 'Call usability_get_review with sessionId and step to view the recorded before/after screenshots. Inspect screenshots before making visual claims.' };
  }
  async observation(id: string, sessionId: string, step: number) {
    const report = await this.load(id);
    const found = report.journeys.find(j => j.sessionId === sessionId)?.steps.find(s => s.step === step);
    if (!found) throw new ReviewError('Observation does not belong to this comparison.');
    return found;
  }
  async submit(id: string, revision: number, raw: unknown) {
    if (this.busy.has(id)) throw new ReviewError('Review update in progress. Retrieve the current review before retrying.');
    this.busy.add(id);
    try {
      const submission = reviewSubmissionSchema.parse(raw);
      const report = await this.load(id); const comparison = report.comparison;
      const digest = createHash('sha256').update(JSON.stringify({ revision, submission })).digest('hex');
      if (comparison.lastSubmission === digest) return this.get(id);
      if (comparison.revision !== revision || comparison.nextStage !== submission.stage) throw new ReviewError('Stale review revision or unexpected stage. Retrieve the current review.');
      const validateEvidence = (refs: z.infer<typeof reference>[]) => {
        for (const ref of refs) {
          const step = report.journeys.find(j => j.sessionId === ref.sessionId)?.steps.find(s => s.step === ref.step);
          if (!step || !step.result.ok || step.result.blocked) throw new ReviewError('Evidence must reference an existing successful, nonblocked step.');
        }
      };
      if (submission.stage === 'participants') {
        if (submission.sessions.length !== report.sessions.length || new Set(submission.sessions.map(s => s.sessionId)).size !== report.sessions.length) throw new ReviewError('Supply exactly one entry for each session.');
        for (const entry of submission.sessions) {
          if (!report.sessions.some(s => s.id === entry.sessionId)) throw new ReviewError('Unknown session.');
          for (const finding of entry.findings) validateEvidence(finding.stepNumbers.map(step => ({ sessionId: entry.sessionId, step })));
          const record = JSON.parse(await this.recorder.read(entry.sessionId, 'journey')) as SessionRecord;
          const individual = sessionReport(record, entry.findings);
          for (const finding of individual.findings) report.findings.push({ ...finding, id: `${entry.sessionId}:${finding.id}` });
        }
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        report.findings.sort((a,b) => severityOrder[a.severity] - severityOrder[b.severity]);
        comparison.ungroupedFindingIds = report.findings.map(f => f.id);
        comparison.nextStage = 'synthesis';
      } else if (submission.stage === 'synthesis') {
        const assigned = new Set<string>();
        const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        comparison.patterns = submission.patterns.map((group, i) => {
          const findings = group.findingIds.map(id => {
            const finding = report.findings.find(f => f.id === id);
            if (!finding || assigned.has(id)) throw new ReviewError('Unknown or multiply assigned finding.');
            assigned.add(id); return finding;
          });
          if (group.assessments.length !== comparison.participants.length || new Set(group.assessments.map(a => a.participantId)).size !== comparison.participants.length) throw new ReviewError('Assess each stable participant exactly once.');
          for (const a of group.assessments) {
            const participant = comparison.participants.find(p => p.participantId === a.participantId);
            if (!participant || a.evidence.some(e => !participant.sessionIds.includes(e.sessionId))) throw new ReviewError('Assessment evidence belongs to another participant.');
            validateEvidence(a.evidence);
            if ((a.status === 'experienced' || a.status === 'successful') && !a.evidence.length) throw new ReviewError('Experienced/successful assessments require evidence.');
            const memberEvidence = findings.flatMap(f => f.evidence).filter(e => participant.sessionIds.includes(e.sessionId));
            if (a.status === 'experienced' && !a.evidence.some(ref => memberEvidence.some(e => e.sessionId === ref.sessionId && e.stepNumbers.includes(ref.step)))) throw new ReviewError('Experienced assessment must cite a member finding.');
            if (memberEvidence.length && a.status !== 'experienced') throw new ReviewError('A member finding requires an experienced assessment; describe successful counterevidence in its explanation.');
          }
          return { ...group, id: `P-${i + 1}`, participantCount: group.assessments.filter(a => a.status === 'experienced').length,
            severity: findings.map(f => f.severity).sort((a,b) => rank[a]! - rank[b]!)[0]! };
        }).sort((a,b) => rank[a.severity]! - rank[b.severity]! || b.participantCount - a.participantCount);
        comparison.ungroupedFindingIds = report.findings.filter(f => !assigned.has(f.id)).map(f => f.id);
        comparison.nextStage = 'ux';
      } else {
        for (const note of submission.notes) validateEvidence(note.evidence);
        comparison.reviews[submission.stage] = { status: 'complete', notes: submission.notes };
        comparison.nextStage = submission.stage === 'ux' ? 'content' : 'complete';
      }
      comparison.revision++; comparison.lastSubmission = digest;
      await this.recorder.finish(report);
      return this.get(id);
    } finally { this.busy.delete(id); }
  }
}
