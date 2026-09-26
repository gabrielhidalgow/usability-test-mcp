export { renderExecutiveMarkdown as renderMarkdown } from './executive.js';
import { relative } from 'node:path';
import type { SuggestedChange, UsabilityReport } from '../core/types.js';
import { describeAction } from '../core/action-description.js';
import { PRINCIPLES } from '../methodology/principles.js';
import { isOutsideFocusOnly } from './executive.js';
import { describePolicy, policyEffect, summarizePolicy } from '../core/policy-summary.js';

const METHODOLOGY_DOC = 'https://github.com/gabrielhidalgow/usability-test-mcp/blob/main/docs/METHODOLOGY.md';
function principleTags(ids: readonly string[] | undefined): string[] {
  if (!ids?.length) return [];
  return [`Principles (labels, not evidence): ${ids.map(id => `${id} — ${PRINCIPLES.find(p => p.id === id)?.title ?? 'unknown'}`).map(escape).join('; ')}`, ''];
}

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
    ...(report.platform === 'prototype' ? [`Prototype: ${escape(report.target)} (static design screens; source and screen order are in the prototype store). Targets and frame names were not shown to participants.`, ''] : []),
    ...(report.focus ? [`Focus area: ${escape(report.focus.name)}${report.focus.description ? ` — ${escape(report.focus.description)}` : ''}. Start page: ${escape(report.focus.startPath ?? 'product URL')}. In scope: ${report.focus.includePaths.map(escape).join(', ') || 'not tracked'}. A journey ends after ${report.focus.leaveLimit} consecutive steps outside. Participants were not told the boundary.`, ''] : []),
    '## Executive summary', '',
    `${report.sessions.length} synthetic session(s); ${report.sessions.filter(s => s.status === 'completed').length} reported completion; ${report.findings.length} evidence-linked usability finding(s).`, '',
    '## Task outcomes', '', '| Participant | Outcome | Actions | Simulated wrong turns | Backtracks |',
    '| --- | --- | --- | --- | --- |'];
  if (report.exercise === 'first-impression') lines.splice(4, 0, '**FIRST-IMPRESSION EXERCISE — the participant only looked at and scrolled the starting screen. There is no task outcome; do not pool with task journeys.**', '');
  if (report.supersededBy) lines.splice(4, 0, `**ARCHIVED ATTEMPT — superseded by ${escape(report.supersededBy)}. All counts and findings below are historical evidence, excluded from current conclusions.**`, '');
  if (report.correction) lines.splice(4, 0, '## Correction history', '',
    `Replaces: ${escape(report.correction.priorRunId)}. Reason: ${escape(report.correction.reason)}. Recorded: ${escape(report.correction.recordedAt)}.`, '',
    `Host explanation: ${escape(report.correction.changes)}`, '',
    `Recorded input fields changed: ${report.correction.changedFields.map(escape).join(', ') || 'none'}. Prior screenshots and journeys remain in the previous attempt. This replacement does not add participants.`, '');
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
        `Recommendation: ${escape(pattern.recommendation)}`, '', ...changeDetails(pattern.suggestedChange), ...principleTags(pattern.principleIds),
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
      for (const note of review.notes) lines.push(`### ${escape(note.title)}`, '', `Basis: ${note.basis === 'recorded-obstacle' ? 'recorded obstacle (the participant struggled here)' : 'expert-identified risk (not observed as a participant obstacle)'}.`, '', escape(note.observation), '', `Recommendation: ${escape(note.recommendation)}`, '', ...changeDetails(note.suggestedChange), ...principleTags(note.principleIds), evidenceLinks(note.evidence), '');
      if (review.status === 'complete' && !review.notes.length) lines.push('No additional recommendations submitted.', '');
      if (review.status === 'complete') {
        lines.push(`#### ${role === 'ux' ? 'UX' : 'Content'} principle coverage`, '');
        if (!review.coverage?.length) lines.push('Coverage not recorded. This is not evidence that any principle was satisfied.', '');
        else {
          lines.push('| Principle | Status | Note and evidence |', '| --- | --- | --- |');
          for (const entry of review.coverage) lines.push(`| ${escape(entry.principleId)} | ${entry.status} | ${escape(entry.note ?? '')} ${evidenceLinks(entry.evidence)} |`);
          lines.push('', 'Not-encountered and inconclusive mean the journeys did not provide evidence either way; they are not passes.', '');
        }
      }
    }
  }
  for (const s of report.sessions) {
    if (s.contextCheck) lines.push('', `Context declaration: ${escape(s.contextCheck.mode)}; ${escape(s.contextCheck.isolation)}. Current-context exposure: ${s.contextCheck.exposure.map(escape).join(', ') || 'none reported'}. Freshness is not independently verified.`);
    if (s.presentation) lines.push('', `Browser presentation: ${s.presentation}.`);
    if (s.handoff) lines.push('', `Setup discovery: ${s.handoff.discoveryId}. Context handoff: ${s.handoff.context} (host-reported, not independently verified). Discovery screens and suggested routes were excluded from participant packets.${s.handoff.startingStateConfirmed ? ' Native starting state confirmed by host; no automatic data reset or isolation.' : ''}`);
  }
  lines.push('', '## Most important findings', '');
  if (!report.findings.length) lines.push(report.comparison?.nextStage === 'participants' ? 'Participant interpretation is pending.' : 'No evidence-linked usability issues were reported. This is not evidence that the product has no issues.');
  const outside = report.findings.filter(f => isOutsideFocusOnly(report, f));
  for (const issue of [...report.findings.filter(f => !outside.includes(f)), ...outside]) {
    if (issue === outside[0]) lines.push('## Outside the focus area', '', 'These findings happened only on pages outside the focus area. They are secondary unless they explain why participants left the focus.', '');
    lines.push(`### ${issue.id} — ${escape(issue.title)}`, '',
      `Severity: ${issue.severity} · Task impact: ${issue.taskImpact} · Interpretation confidence: ${issue.confidence}`, '',
      `Participants affected: ${issue.participantsAffected.map(escape).join(', ')}`, '',
      `Observed behaviour: ${escape(issue.observedBehaviour)}`, '',
      `Why this may be a usability problem: ${escape(issue.likelyUsabilityProblem)}`, '',
      `Recommendation: ${escape(issue.recommendation)}`, '', ...changeDetails(issue.suggestedChange), ...principleTags(issue.principleIds), 'Evidence:', '',
      ...issue.evidence.map(e => `- ${e.sessionId}, steps ${e.stepNumbers.join(', ')}: ${e.screenshots.map(link).join(' · ')}`), '');
  }
  lines.push('## Participant journeys', '');
  for (const journey of report.journeys) {
    lines.push(`### ${escape(report.sessions.find(s => s.id === journey.sessionId)?.persona.name ?? journey.sessionId)}`, '');
    for (const step of journey.steps) {
      lines.push(`- Step ${step.step}${step.focus === 'outside' ? ' (outside focus)' : ''}: **${escape(describeAction(step))}** — ${escape(step.result.message)}. ${link(step.before.screenshot.path)}${step.after ? ` → ${link(step.after.screenshot.path)}` : ''}`,
        `  Simulated commentary: ${escape(step.decision.simulatedCommentary)}`);
      if (step.result.prototype) lines.push(`  Prototype tap: ${step.result.prototype.target === 'hit' ? 'on the marked target' : step.result.prototype.target === 'miss' ? `missed the marked target${step.result.prototype.movedOn ? '; facilitator moved on' : ''}` : 'unscored (no marked target)'} on screen ${escape(step.result.prototype.screenId)}.`);
      if (step.decision.userExpectation) lines.push(`  Expected: ${escape(step.decision.userExpectation)} → Result: ${step.after ? `${escape(step.after.title)} (${escape(step.after.location)})` : 'no resulting screen recorded'}`);
    }
    lines.push('');
  }
  if (report.policyDiagnostics?.length) {
    lines.push('', '## Browser policy diagnostics', '', 'These are harness restrictions, not product usability findings. Request purpose unknown: tracking is inferred from a third-party destination, not verified. No request URLs or response bodies are stored.', '',
      `Summary: ${describePolicy(summarizePolicy(report.policyDiagnostics))}.`, '',
      '| Effect | Reason | Method / resource | Request context | Destination | Journey | Count | Steps |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    // Identical events repeat on every page (tracking pings); one row per kind keeps the appendix readable.
    const groups = new Map<string, { d: NonNullable<typeof report.policyDiagnostics>[number]; count: number; steps: Set<string> }>();
    for (const d of report.policyDiagnostics) {
      const key = [policyEffect(d), d.reason, d.phase, d.method, d.resourceType, d.requestContext, d.destination, d.stopsJourney].join('|');
      const group = groups.get(key) ?? { d, count: 0, steps: new Set<string>() };
      group.count++; group.steps.add(report.sessions.length > 1 ? `${d.sessionId.slice(0, 16)}… step ${d.step}` : String(d.step));
      groups.set(key, group);
    }
    for (const { d, count, steps } of groups.values()) lines.push(`| ${policyEffect(d)} | ${d.reason} (${d.phase}) | ${escape(d.method)} / ${escape(d.resourceType)} | ${d.requestContext ?? 'unknown'} | ${d.destination ?? 'unknown'} | ${d.stopsJourney ? 'Stopped journey' : 'Continued'} | ${count} | ${[...steps].map(escape).join(', ')} |`);
  }

  if (report.baselineComparison) {
    const c = report.baselineComparison;
    lines.push('', '## Baseline → retest comparison', '', `Baseline: ${escape(c.baselineId)} · recorded ${escape(c.recordedAt)} · revision ${c.revision}.`, '',
      c.comparable ? 'Conditions matched: same task, device, profiles and participant count.' : `Not fully comparable: ${c.mismatches.map(escape).join('; ')}. Only observed-again or inconclusive outcomes were allowed.`, '',
      '| Baseline finding | Outcome | Explanation and retest evidence |', '| --- | --- | --- |');
    for (const a of c.assessments) lines.push(`| ${escape(a.baselineFindingId)} — ${escape(a.baselineTitle)} | ${a.outcome} | ${escape(a.explanation)} ${a.retestEvidence.map(r => `${r.sessionId}, step ${r.step}`).join(' · ')} |`);
    lines.push('', `Newly observed in the retest: ${c.newlyObserved.map(n => `${escape(n.retestFindingId)} (${escape(n.title)})`).join(', ') || 'none recorded'}.`, '',
      'Not observed on a comparable path is not proof of a fix. Participant counts from the two runs are not merged.', '');
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
    '## Methodology', '',
    report.methodologyVersion ? `Findings and reviews used methodology ${escape(report.methodologyVersion)}: principles adapted from Steve Krug (Don’t Make Me Think; Rocket Surgery Made Easy) and Susan Weinschenk (100 Things Every Designer Needs to Know About People). See ${METHODOLOGY_DOC}. Principles are lenses for reading recorded evidence; they are not evidence and do not show that an AI reproduces human perception.` : 'Methodology: not recorded (report created before methodology versioning).', '',
    '## Limitations', '', ...report.limitations.map(l => `- ${escape(l)}`), '');
  return lines.join('\n');
}
