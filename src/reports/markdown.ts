import { relative } from 'node:path';
import type { UsabilityReport } from '../core/types.js';
import { describeAction } from '../core/action-description.js';

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]#|])/g, '\\$1').replace(/\n/g, ' ');
}
export function renderMarkdown(report: UsabilityReport, directory: string): string {
  const link = (path: string) => `[Screenshot](${relative(directory, path).split('/').map(encodeURIComponent).join('/')})`;
  const lines = ['# Usability Test Report', '', report.disclaimer, '', '## Test setup', '',
    `Product: ${escape(report.target)}`, '', 'Platform: web', '', `Date: ${report.generatedAt}`, '',
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
  lines.push('', '## Most important findings', '');
  if (!report.findings.length) lines.push('No evidence-linked usability issues were reported. This is not evidence that the product has no issues.');
  for (const issue of report.findings) {
    lines.push(`### ${issue.id} — ${escape(issue.title)}`, '',
      `Severity: ${issue.severity} · Task impact: ${issue.taskImpact} · Interpretation confidence: ${issue.confidence}`, '',
      `Participants affected: ${issue.participantsAffected.map(escape).join(', ')}`, '',
      `Observed behaviour: ${escape(issue.observedBehaviour)}`, '',
      `Why this may be a usability problem: ${escape(issue.likelyUsabilityProblem)}`, '',
      `Recommendation: ${escape(issue.recommendation)}`, '', 'Evidence:', '',
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
