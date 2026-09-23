export { renderExecutiveMarkdown as renderMarkdown } from './executive.js';
import { relative } from 'node:path';
import type { SuggestedChange, UsabilityReport } from '../core/types.js';
import { describeAction } from '../core/action-description.js';

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]#|])/g, '\\$1').replace(/\n/g, ' ');
}
function changeDetails(change: SuggestedChange | undefined): string[] {
  if (!change) return [];
  return [`Suggested ${change.kind} change — ${escape(change.location)}: ${escape(change.proposal)}`, '',
    ...(change.replacement ? [`Current → proposed wording: “${escape(change.replacement.before)}” → “${escape(change.replacement.after)}”`, ''] : []),
    `Verify after the change: ${escape(change.verify)}`, ''];
}
export function renderDetailedMarkdown(report: UsabilityReport, directory: string): string {
  const link = (path: string) => `[Screenshot](${relative(directory, path).split('/').map(encodeURIComponent).join('/')})`;
  const lines = ['# Usability Test — Evidence appendix', '', '[Back to executive report](report.md)', '', report.disclaimer, '', '## Test setup', '',
    `Product: ${escape(report.target)}`, '', `Platform: ${report.platform ?? 'web'}`, '', `Date: ${report.generatedAt}`, '',
    `Scenario: ${escape(report.scenario)}`, '', `Goal: ${escape(report.goal)}`, '',
    '## Executive summary', '',
    `${report.sessions.length} synthetic session(s); ${report.sessions.filter(s => s.status === 'completed').length} reported completion; ${report.findings.length} evidence-linked usability finding(s).`, '',
    '## Task outcomes', '', '| Participant | Outcome | Actions | Simulated wrong turns | Backtracks |',
    '| --- | --- | --- | --- | --- |'];
  if (report.sessions.some(s => s.provider.startsWith('deterministic-fixture-test-double'))) {
    lines.splice(2, 0, '**DEMO / TEST DOUBLE: these journeys exercise the fixture and are not AI usability research.**', '');
  }
  for (const s of report.sessions) lines.push(`| ${escape(s.persona.name)} | ${s.status} | ${s.actions} | ${s.wrongTurns} | ${s.backtracks} |`);
  for (const s of report.sessions) lines.push('', `${escape(s.persona.name)} — ${escape(s.reason)} (provider: ${escape(s.provider)})`);
  for (const s of report.sessions) if (s.continuation) lines.push('', `Continuation of ${s.continuation.previousSessionId}. Browser state reset; previous actions were not replayed. This segment is not an independent participant.${s.continuation.uncertainAction ? ' The last action in the prior segment had an uncertain result.' : ''}`);
  if (report.comparison) {
    const comparison = report.comparison;
    const evidenceLinks = (refs: { sessionId: string; step: number }[]) => refs.map(ref => {
      const step = report.journeys.find(j => j.sessionId === ref.sessionId)?.steps.find(s => s.step === ref.step);
      return `${ref.sessionId}, step ${ref.step}${step ? `: ${link(step.before.screenshot.path)}${step.after ? ` → ${link(step.after.screenshot.path)}` : ''}` : ''}`;
    }).join(' · ');
    lines.push('', '## Participant comparison', '', `Review status: ${comparison.nextStage === 'complete' ? 'complete' : `pending — ${comparison.nextStage}`}.`, '',
      'These are synthetic perspectives. Shared model biases can recur; context isolation is host-reported and not verified.', '',
      '| Participant ID | Profile | Basis | Model context | Outcome |', '| --- | --- | --- | --- | --- |');
    for (const participant of comparison.participants) {
      const sessions = report.sessions.filter(s => participant.sessionIds.includes(s.id));
      lines.push(`| ${participant.participantId} | ${escape(participant.name)} | ${participant.basis} | ${participant.contextIsolation} | ${sessions.map(s => s.status).join(', ')} |`);
    }
    for (const s of report.sessions) lines.push('', `${escape(s.persona.name)} (${s.id}): ${escape(s.persona.context)}. Prior knowledge: ${s.persona.productKnowledge}; technical confidence: ${s.persona.technicalConfidence}. Information needs: ${(s.persona.informationNeeds ?? []).map(escape).join('; ') || 'unspecified'}. Constraints: ${s.persona.constraints.map(escape).join('; ') || 'none supplied'}.`);
    lines.push('', '## Patterns and counterevidence', '');
    if (!comparison.patterns.length) lines.push(comparison.nextStage === 'participants' || comparison.nextStage === 'synthesis' ? 'Pattern review is pending; no conclusion about recurrence is available.' : 'No shared patterns were submitted. Individual findings remain below.');
    for (const pattern of comparison.patterns) {
      lines.push(`### ${pattern.id} — ${escape(pattern.title)}`, '',
        `${pattern.severity} · Observed in ${pattern.participantCount} simulated journey(s), counting each participant once.`, '',
        `Interface: ${escape(pattern.screenOrControl)}. Obstacle: ${escape(pattern.obstacle)}`, '',
        `Recommendation: ${escape(pattern.recommendation)}`, '', ...changeDetails(pattern.suggestedChange),
        `Source findings: ${pattern.findingIds.map(escape).join(', ')}`, '',
        '| Participant ID | Observation | Explanation and evidence |', '| --- | --- | --- |');
      for (const a of pattern.assessments) lines.push(`| ${a.participantId} | ${a.status} | ${escape(a.explanation)} ${evidenceLinks(a.evidence)} |`);
      lines.push('');
    }
    lines.push('Not-observed is not proof of absence. Successful paths and conflicting evidence are retained in the assessments and journeys.', '',
      `Ungrouped individual findings: ${comparison.ungroupedFindingIds.map(escape).join(', ') || 'none currently recorded'}.`, '');
    for (const role of ['ux', 'content'] as const) {
      const review = comparison.reviews[role];
      lines.push(`## ${role === 'ux' ? 'UX' : 'Content'} expert review`, '', `Status: ${review.status}. Expert interpretations do not count as participant observations.`, '');
      for (const note of review.notes) lines.push(`### ${escape(note.title)}`, '', escape(note.observation), '', `Recommendation: ${escape(note.recommendation)}`, '', ...changeDetails(note.suggestedChange), evidenceLinks(note.evidence), '');
      if (review.status === 'complete' && !review.notes.length) lines.push('No additional recommendations submitted.', '');
    }
  }
  for (const s of report.sessions) {
    if (s.presentation) lines.push('', `Browser presentation: ${s.presentation}.`);
    if (s.handoff) lines.push('', `Setup discovery: ${s.handoff.discoveryId}. Context handoff: ${s.handoff.context} (host-reported, not independently verified). Discovery screens and suggested routes were excluded from participant packets.${s.handoff.startingStateConfirmed ? ' Native starting state confirmed by host; no automatic data reset or isolation.' : ''}`);
  }
  lines.push('', '## Most important findings', '');
  if (!report.findings.length) lines.push(report.comparison?.nextStage === 'participants' ? 'Participant interpretation is pending.' : 'No evidence-linked usability issues were reported. This is not evidence that the product has no issues.');
  for (const issue of report.findings) {
    lines.push(`### ${issue.id} — ${escape(issue.title)}`, '',
      `Severity: ${issue.severity} · Task impact: ${issue.taskImpact} · Interpretation confidence: ${issue.confidence}`, '',
      `Participants affected: ${issue.participantsAffected.map(escape).join(', ')}`, '',
      `Observed behaviour: ${escape(issue.observedBehaviour)}`, '',
      `Why this may be a usability problem: ${escape(issue.likelyUsabilityProblem)}`, '',
      `Recommendation: ${escape(issue.recommendation)}`, '', ...changeDetails(issue.suggestedChange), 'Evidence:', '',
      ...issue.evidence.map(e => `- ${e.sessionId}, steps ${e.stepNumbers.join(', ')}: ${e.screenshots.map(link).join(' · ')}`), '');
  }
  lines.push('## Participant journeys', '');
  for (const journey of report.journeys) {
    lines.push(`### ${escape(report.sessions.find(s => s.id === journey.sessionId)?.persona.name ?? journey.sessionId)}`, '');
    for (const step of journey.steps) {
      lines.push(`- Step ${step.step}: **${escape(describeAction(step))}** — ${escape(step.result.message)}. ${link(step.before.screenshot.path)}${step.after ? ` → ${link(step.after.screenshot.path)}` : ''}`,
        `  Simulated commentary: ${escape(step.decision.simulatedCommentary)}`);
    }
    lines.push('');
  }
  if (report.policyDiagnostics?.length) {
    lines.push('', '## Browser policy diagnostics', '', 'These are harness restrictions, not product usability findings. No request URLs or response bodies are stored.', '',
      '| Session | Step | Reason | Method / resource | Effect |', '| --- | --- | --- | --- | --- |');
    for (const d of report.policyDiagnostics) lines.push(`| ${escape(d.sessionId)} | ${d.step} | ${d.reason} (${d.phase}) | ${escape(d.method)} / ${escape(d.resourceType)} | ${d.stopsJourney ? 'Stops journey' : 'Resource blocked; journey may continue with reduced fidelity'} |`);
  }
  lines.push('', '## Accessibility findings', '', '### Automated', '');
  if (!report.accessibility.length) lines.push('No automated scans were completed.');
  for (const scan of report.accessibility) {
    lines.push(`- ${scan.sessionId}, state ${scan.step}: ${scan.error ? escape(scan.error) : `${scan.findings.length} axe rule violation(s)`}. ${link(scan.screenshot)}`);
    for (const f of scan.findings) lines.push(`  - ${escape(f.id)} (${escape(f.impact ?? 'unrated')}): ${escape(f.description)} — ${f.targets.length} affected target(s).`);
  }
  lines.push('', '### Interaction', '',
    'Keyboard actions and focused controls appear in the journey JSON. No full keyboard, focus-visibility, or screen-reader compliance claim is made.', '',
    '## Positive observations', '',
    'Successful actions and visible completion evidence are retained in the journeys; no unsupported positive findings are inferred.', '',
    '## Limitations', '', ...report.limitations.map(l => `- ${escape(l)}`), '');
  return lines.join('\n');
}
