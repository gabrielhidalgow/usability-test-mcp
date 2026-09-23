import { relative } from 'node:path';
import type { SuggestedChange, UsabilityReport } from '../core/types.js';

function compact(value: string, max = 160): string {
  const text = value.replace(/\s+/g, ' ').trim();
  const shortened = text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text;
  return shortened.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]#|])/g, '\\$1');
}
const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, review: 4 };
type ActionItem = { title: string; why: string; recommendation: string; severity: string; count: number;
  confidence?: string; source: string; screenshot?: string; change?: SuggestedChange; counterpoint?: string };

export function renderExecutiveMarkdown(report: UsabilityReport, directory: string): string {
  const screenshot = (path: string) => `[Screenshot](${relative(directory, path).split('/').map(encodeURIComponent).join('/')})`;
  const rootId = (id: string) => report.sessions.find(s => s.id === id)?.continuation?.rootSessionId ?? id;
  const participants = new Map<string, (typeof report.sessions)[number]>();
  for (const session of report.sessions) participants.set(rootId(session.id), session);
  const outcomes = [...participants.values()];
  const completed = outcomes.filter(s => s.status === 'completed').length;
  const comparison = report.comparison;
  const pending = comparison && comparison.nextStage !== 'complete';
  const grouped = new Set(comparison?.patterns.flatMap(p => p.findingIds) ?? []);
  const actions: ActionItem[] = [];
  for (const pattern of comparison?.patterns ?? []) {
    const members = report.findings.filter(f => pattern.findingIds.includes(f.id));
    const confidence = members.some(f => f.confidence === 'low') ? 'low' : members.some(f => f.confidence === 'medium') ? 'medium' : 'high';
    const successes = pattern.assessments.filter(a => a.status === 'successful').length;
    const unclear = pattern.assessments.filter(a => a.status === 'inconclusive' || a.status === 'not-observed').length;
    actions.push({ title: pattern.title, why: pattern.obstacle, recommendation: pattern.recommendation,
      severity: pattern.severity, count: pattern.participantCount, confidence, source: 'Journey evidence',
      screenshot: members[0]?.evidence[0]?.screenshots[0], change: pattern.suggestedChange,
      counterpoint: [successes ? `${successes} successful counterexample(s)` : '', unclear ? `${unclear} not-observed/inconclusive` : ''].filter(Boolean).join('; ') });
  }
  for (const finding of report.findings.filter(f => !grouped.has(f.id))) actions.push({
    title: finding.title, why: finding.likelyUsabilityProblem, recommendation: finding.recommendation,
    severity: finding.severity, count: new Set(finding.evidence.map(e => rootId(e.sessionId))).size,
    confidence: finding.confidence, source: 'Journey evidence', screenshot: finding.evidence[0]?.screenshots[0], change: finding.suggestedChange,
  });
  for (const role of ['ux', 'content'] as const) for (const note of comparison?.reviews[role].notes ?? []) {
    const ref = note.evidence[0];
    const step = report.journeys.find(j => j.sessionId === ref?.sessionId)?.steps.find(s => s.step === ref?.step);
    actions.push({ title: note.title, why: note.observation, recommendation: note.recommendation, severity: 'review',
      count: 0, source: role === 'ux' ? 'UX expert review' : 'Content expert review', screenshot: step?.before.screenshot.path, change: note.suggestedChange });
  }
  actions.sort((a,b) => (severityRank[a.severity] ?? 4) - (severityRank[b.severity] ?? 4) || b.count - a.count);
  // Remove exact duplicate recommendations while preserving the strongest source.
  const seen = new Set<string>();
  const distinct = actions.filter(a => {
    const key = `${a.title} ${a.change ? JSON.stringify(a.change) : a.recommendation}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  const selected = distinct.slice(0, 5);
  const lines = ['# Usability Test — Executive report', '',
    `**Task:** ${compact(report.goal, 220)}`, '',
    `**Product:** ${compact(report.target, 160)} · **Date:** ${report.generatedAt.slice(0, 10)} · **Scope:** ${report.platform === 'native' ? 'native app (experimental)' : report.viewport === 'mobile' ? 'mobile web' : report.viewport === 'desktop' ? 'desktop web' : 'web (device unspecified)'} · ${outcomes.length} synthetic participant(s).`, '',
    `**Audience:** ${compact([...new Set(outcomes.map(s => s.persona.context))].join('; '), 180)}`, '',
    '**Evidence from synthetic participants, not human research.** Completion and findings are model judgments.', ''];
  if (report.sessions.some(s => s.provider.includes('test-double'))) lines.push('**DEMO / TEST DOUBLE — fixture verification, not AI usability research.**', '');
  lines.push('## At a glance', '',
    `**Outcome:** Reported completion in ${completed} of ${outcomes.length} simulated journeys.${completed < outcomes.length ? ' Other journeys remain incomplete or inconclusive; see outcomes below.' : ''}`, '');
  if (pending) lines.push(`**Provisional report:** ${comparison.nextStage} review is pending. Finish the review before prioritising changes.`, '');
  else if (selected.length) {
    const first = selected[0]!;
    const change = first.change;
    const action = change?.replacement ? `${change.location}: replace “${change.replacement.before}” with “${change.replacement.after}”.` : change?.proposal ?? first.recommendation;
    lines.push(`**First action:** ${compact(action, 180)}`, '');
  }
  else lines.push('**Decision:** No evidence-linked fixes were recorded. This does not establish that the interface has no usability problems.', '');
  lines.push('| Participant | Outcome | Key observation |', '| --- | --- | --- |');
  outcomes.slice(0, 5).forEach((s, i) => lines.push(`| P${i + 1} — ${compact(s.persona.name, 45)} | ${s.status} | ${compact(s.reason, 100)} |`));
  if (outcomes.length > 5) lines.push('', 'Additional participants are in the evidence appendix.');
  if (report.sessions.some(s => s.continuation)) lines.push('', 'A continuation has a reset browser and is not an independent participant. Each participant is counted once; the latest recorded segment supplies its outcome.');
  lines.push('', '## Recommended actions', '');
  if (!selected.length) lines.push(pending ? 'Actions are pending evidence review.' : 'No supported action points were submitted. Validate the task with real users before drawing a broader conclusion.', '');
  selected.forEach((action, index) => {
    const priority = action.severity === 'critical' || action.severity === 'high' ? 'Fix first' : action.severity === 'medium' ? 'Next' : action.severity === 'review' ? 'Review suggestion' : 'Consider';
    lines.push(`### ${index + 1}. ${priority} — ${compact(action.title, 80)}`, '',
      `${action.source}${action.count ? ` · observed in ${action.count} simulated journey(s)` : ' · not a participant count'}${action.confidence ? ` · confidence: ${action.confidence}` : ''}.${action.screenshot ? ` ${screenshot(action.screenshot)}` : ''}`, '',
      `**Why:** ${compact(action.why, 140)}`, '');
    if (action.change) {
      lines.push(`**${action.change.kind === 'copy' ? 'Copy' : action.change.kind === 'design' ? 'Design' : 'Interaction'} change — ${compact(action.change.location, 80)}:** ${compact(action.change.proposal, 200)}`, '');
      if (action.change.replacement) lines.push(`**Current → proposed:** “${compact(action.change.replacement.before, 100)}” → “${compact(action.change.replacement.after, 100)}”`, '');
      lines.push(`**Check after the change:** ${compact(action.change.verify, 140)}`, '');
    } else lines.push(`**Change:** ${compact(action.recommendation, 220)}`, '');
    if (action.counterpoint) lines.push(`**Counterevidence:** ${action.counterpoint}. Not-observed is not proof of absence.`, '');
  });
  if (distinct.length > selected.length) lines.push(`${distinct.length - selected.length} additional action(s) are in the [evidence appendix](details.md).`, '');
  const positive = comparison?.patterns.flatMap(p => p.assessments.filter(a => a.status === 'successful').map(a => ({ text: a.explanation, ref: a.evidence[0] }))) ?? [];
  if (!positive.length) for (const s of outcomes.filter(s => s.status === 'completed')) {
    const final = report.journeys.find(j => j.sessionId === s.id)?.steps.findLast(step => step.decision.selectedAction.type === 'finish' && step.result.ok);
    if (final?.decision.selectedAction.type === 'finish') positive.push({ text: final.decision.selectedAction.visibleEvidence, ref: { sessionId: s.id, step: final.step } });
  }
  lines.push('## What worked', '');
  const positiveSeen = new Set<string>();
  const positives = positive.filter(p => { if (!p.text.trim() || positiveSeen.has(p.text)) return false; positiveSeen.add(p.text); return true; }).slice(0, 2);
  for (const p of positives) {
    const step = report.journeys.find(j => j.sessionId === p.ref?.sessionId)?.steps.find(s => s.step === p.ref?.step);
    lines.push(`- ${compact(p.text, 140)}${step ? ` ${screenshot(step.after?.screenshot.path ?? step.before.screenshot.path)}` : ''}`);
  }
  if (!positives.length) lines.push('No specific positive observation was supported; consult the journeys before changing successful parts of the interface.');
  lines.push('', '## Evidence limits and next check', '');
  const diagnostics = report.policyDiagnostics?.length ?? 0;
  if (diagnostics) lines.push(`**Browser policy diagnostics:** ${diagnostics} restriction event(s) may have altered the interface. Treat affected findings as provisional; resolve test-environment restrictions first.`, '');
  if (report.limitations.some(l => /did not settle|transient visual/i.test(l))) lines.push('Some screenshots did not settle. Recheck transient visual findings before changing the design.', '');
  const rules = new Set(report.accessibility.flatMap(scan => scan.findings.map(f => f.id)));
  const errors = report.accessibility.filter(scan => scan.error).length;
  lines.push(report.accessibility.length ? `Automated accessibility: ${rules.size} distinct rule(s) flagged${errors ? `; ${errors} scan(s) failed` : ''}. This is not a WCAG conformance audit.` : 'Automated accessibility was not assessed.', '');
  if (comparison) {
    const shared = comparison.participants.some(p => p.contextIsolation === 'shared');
    const unknown = comparison.participants.some(p => p.contextIsolation === 'unknown');
    const assumptions = comparison.participants.filter(p => p.basis !== 'owner-research').length;
    lines.push(`Profiles: ${assumptions} assumption-based or unspecified. Model context: ${shared ? 'shared context reported' : unknown ? 'isolation unknown' : 'fresh contexts reported by host, not independently verified'}. Shared-model bias can recur.`, '');
  } else lines.push('Model-context isolation is not independently verified. Profile assumptions and full limitations are in the appendix.', '');
  lines.push('**Next check:** Retest the same task and profiles after changes; compare evidence, including successful paths. Validate important findings with real users. Proposed wording and design changes are hypotheses, not proven improvements.', '',
    '[Full evidence, journeys, UX/content reviews and limitations](details.md) · [Structured report](report.json)', '',
    'Long fields may be shortened with “…”; the appendix retains complete wording.', '');
  return lines.join('\n');
}
