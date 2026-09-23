import type { Interpretation, SessionRecord, UsabilityIssue, UsabilityReport } from './types.js';
import { isGroundedChange } from './suggested-change.js';
import { describeAction } from './action-description.js';

export const DISCLAIMER = 'These findings come from synthetic participants. Simulated commentary is not real-user evidence, and this does not replace research with real people.';
const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
export function severityFor(impact: Interpretation['taskImpact']): UsabilityIssue['severity'] {
  return ({ blocked: 'critical', 'major-delay': 'high', 'minor-delay': 'medium', 'no-task-impact': 'low' } as const)[impact];
}
export function sessionReport(session: SessionRecord, interpretations: Interpretation[]): UsabilityReport {
  const findings: UsabilityIssue[] = [];
  for (const interpretation of interpretations.slice(0, 8)) {
    const steps = session.journey.filter(s => interpretation.stepNumbers.includes(s.step) && !s.result.blocked);
    // A provider cannot attach findings to invented evidence or a harness safety block.
    if (!steps.length || interpretation.stepNumbers.some(n => !steps.some(s => s.step === n))) continue;
    const impact = interpretation.taskImpact === 'blocked' && session.status === 'completed'
      ? 'major-delay' : interpretation.taskImpact;
    findings.push({ ...interpretation, suggestedChange: isGroundedChange(interpretation.suggestedChange, steps) ? interpretation.suggestedChange : undefined, taskImpact: impact,
      id: `U-${String(findings.length + 1).padStart(3, '0')}`, severity: severityFor(impact),
      observedBehaviour: steps.map(s => `${session.input.persona.name}, step ${s.step}: ${describeAction(s)}; ${s.result.message}. Simulated commentary: ${s.decision.simulatedCommentary}`).join('\n'),
      participantsAffected: [session.input.persona.name],
      evidence: [{ sessionId: session.id, stepNumbers: steps.map(s => s.step),
        screenshots: [...new Set(steps.flatMap(s => [s.before.screenshot.path, ...(s.after ? [s.after.screenshot.path] : [])]))] }],
    });
  }
  return {
    id: session.id, kind: 'session', synthetic: true, generatedAt: new Date().toISOString(),
    platform: session.input.platform, viewport: session.input.platform === 'web' ? session.input.viewport : undefined, target: session.input.target, scenario: session.input.scenario, goal: session.input.goal, disclaimer: DISCLAIMER,
    sessions: [{ id: session.id, continuation: session.continuation, persona: session.input.persona, status: session.status, reason: session.reason,
      actions: session.actions, wrongTurns: session.journey.filter(s => s.decision.behavior === 'wrong-turn').length,
      backtracks: session.journey.filter(s => s.decision.selectedAction.type === 'back').length, provider: session.provider }],
    policyDiagnostics: (session.policyDiagnostics ?? []).map(d => ({ ...d, sessionId: session.id })),
    findings: findings.sort((a, b) => rank[a.severity] - rank[b.severity]),
    accessibility: session.accessibility.map(s => ({ ...s, sessionId: session.id })),
    journeys: [{ sessionId: session.id, steps: session.journey }],
    limitations: [DISCLAIMER, 'Completion and wrong-turn labels are model judgments grounded in recorded UI evidence, not independently verified facts.',
      'axe detects a subset of accessibility issues; results are not a WCAG conformance audit.',
      'Keyboard sessions record focus and key actions but do not constitute a screen-reader or keyboard conformance audit.',
      'Safety guards may prevent task completion. Safety and infrastructure failures are not product usability findings.',
      'Screenshots and visible text may contain sensitive product data. Automatic redaction cannot sanitize screenshots.',
      ...session.warnings],
  };
}

function clusterKey(issue: UsabilityIssue): string {
  // Conservative matching preserves one-off observations instead of merging by category alone.
  return `${issue.category}:${issue.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
}
export function synthesizeReports(reports: UsabilityReport[], id: string): UsabilityReport {
  const first = reports[0];
  if (!first) throw new Error('A round requires at least one report');
  const clusters = new Map<string, UsabilityIssue>();
  for (const issue of reports.flatMap(r => r.findings)) {
    const key = clusterKey(issue);
    const old = clusters.get(key);
    if (!old) { clusters.set(key, structuredClone(issue)); continue; }
    old.evidence.push(...issue.evidence);
    old.participantsAffected = [...new Set([...old.participantsAffected, ...issue.participantsAffected])];
    old.observedBehaviour += '\n' + issue.observedBehaviour;
    if (rank[issue.severity] < rank[old.severity]) {
      old.severity = issue.severity; old.taskImpact = issue.taskImpact;
    }
  }
  const findings = [...clusters.values()].sort((a, b) => rank[a.severity] - rank[b.severity] ||
    new Set(b.evidence.map(e => e.sessionId)).size - new Set(a.evidence.map(e => e.sessionId)).size);
  findings.forEach((f, i) => { f.id = `U-${String(i + 1).padStart(3, '0')}`; });
  return { ...first, id, kind: 'round', generatedAt: new Date().toISOString(),
    sessions: reports.flatMap(r => r.sessions), findings,
    policyDiagnostics: reports.flatMap(r => r.policyDiagnostics ?? []),
    accessibility: reports.flatMap(r => r.accessibility), journeys: reports.flatMap(r => r.journeys),
    limitations: [...new Set(reports.flatMap(r => r.limitations)),
      'Recurrence is qualitative, not statistically significant. Clustering matches category and normalized title; related findings with different titles remain separate.'],
  };
}
