import { contextQuality } from '../core/context-quality.js';
import { describePolicy, summarizePolicy } from '../core/policy-summary.js';
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
  if (report.supersededBy) return [
    '# Usability Test — Superseded attempt', '',
    `This attempt was replaced by **${report.supersededBy}**.`, '',
    '**Excluded from current participant counts, completion summaries and recurring patterns.** Do not combine this attempt with its replacement. The replacement may still be incomplete.', '',
    '[Archived evidence and correction details](details.md) · [Structured report](report.json)', '',
  ].join('\n');
  if (report.exercise === 'first-impression') return renderFirstImpression(report, directory);
  const screenshot = (path: string) => `[Screenshot](${relative(directory, path).split('/').map(encodeURIComponent).join('/')})`;
  const rootId = (id: string) => report.sessions.find(s => s.id === id)?.continuation?.rootSessionId ?? id;
  const participants = new Map<string, (typeof report.sessions)[number]>();
  for (const session of report.sessions) participants.set(rootId(session.id), session);
  const outcomes = [...participants.values()];
  const completed = outcomes.filter(s => s.status === 'completed').length;
  const quality = outcomes.map(s => contextQuality(report, s));
  const firstVisitSupported = quality.length > 0 && quality.every(q => q.firstVisitSupported);
  const comparison = report.comparison;
  const pending = comparison && comparison.nextStage !== 'complete';
  const grouped = new Set(comparison?.patterns.flatMap(p => p.findingIds) ?? []);
  const outsideOnly = new Set(report.findings.filter(f => isOutsideFocusOnly(report, f)).map(f => f.id));
  let outsideCount = 0;
  const actions: ActionItem[] = [];
  for (const pattern of comparison?.patterns ?? []) {
    const members = report.findings.filter(f => pattern.findingIds.includes(f.id));
    if (members.length && members.every(f => outsideOnly.has(f.id))) { outsideCount++; continue; }
    const confidence = members.some(f => f.confidence === 'low') ? 'low' : members.some(f => f.confidence === 'medium') ? 'medium' : 'high';
    const successes = pattern.assessments.filter(a => a.status === 'successful').length;
    const unclear = pattern.assessments.filter(a => a.status === 'inconclusive' || a.status === 'not-observed').length;
    actions.push({ title: pattern.title, why: pattern.obstacle, recommendation: pattern.recommendation,
      severity: pattern.severity, count: pattern.participantCount, confidence, source: 'Journey evidence',
      screenshot: members[0]?.evidence[0]?.screenshots[0], change: pattern.suggestedChange,
      counterpoint: [successes ? `${successes} successful counterexample(s)` : '', unclear ? `${unclear} not-observed/inconclusive` : ''].filter(Boolean).join('; ') });
  }
  const ungrouped = report.findings.filter(f => !grouped.has(f.id));
  outsideCount += ungrouped.filter(f => outsideOnly.has(f.id)).length;
  for (const finding of ungrouped.filter(f => !outsideOnly.has(f.id))) actions.push({
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
  // Krug's observers list the three most serious problems; more belongs in the appendix.
  const selected = distinct.slice(0, 3);
  const lines = ['# Usability Test — Executive report', '',
    `**Task:** ${compact(report.goal, 220)}`, '',
    `**Product:** ${compact(report.target, 160)} · **Date:** ${report.generatedAt.slice(0, 10)} · **Scope:** ${report.platform === 'native' ? 'native app (experimental)' : report.platform === 'prototype' ? 'static design prototype (e.g. Figma frames)' : report.viewport === 'mobile' ? 'mobile web' : report.viewport === 'desktop' ? 'desktop web' : 'web (device unspecified)'} · ${outcomes.length} synthetic participant(s).`, '',
    `**Audience:** ${compact([...new Set(outcomes.map(s => s.persona.context))].join('; '), 180)}`, '',
    '**Evidence from synthetic participants, not human research.** Completion and findings are model judgments.', ''];
  if (report.sessions.some(s => s.provider.includes('test-double'))) lines.push('**DEMO / TEST DOUBLE — fixture verification, not AI usability research.**', '');
  const contexts = [...new Set(quality.map(q => q.isolation))].join(', ') || 'unknown';
  const policy = summarizePolicy(report.policyDiagnostics);
  const gaps = [completed < outcomes.length ? `${outcomes.length - completed} incomplete journey(s)` : '',
    policy.affectsFidelity ? 'blocked page resources or site requests may have changed what was shown' : '',
    /\b(pdf|download|data\s?sheet)\b/i.test(`${report.goal} ${report.scenario}`) ? 'PDF/download completion is unsupported' : ''].filter(Boolean);
  lines.push('## How to interpret this test', '',
    `- **Method:** ${quality.some(q => q.method === 'informed walkthrough') ? 'Includes informed walkthroughs' : 'Simulated journeys'}; no real participants.${report.methodologyVersion ? ` Reviewed with methodology ${report.methodologyVersion} (Krug, Weinschenk).` : ''}`,
    `- **Context:** ${contexts} (host-reported, not independently verified).${firstVisitSupported ? '' : ' First-visit conclusions are withheld.'}`,
    `- **Coverage gaps:** ${gaps.join('; ') || 'None recorded; this does not establish complete coverage.'}`,
    ...(report.platform === 'prototype' ? [`- **Prototype:** ${prototypeSummaryLine(report)}`] : []),
    ...(report.focus ? [`- **Focus:** ${focusSummary(report)}`] : []),
    ...(report.baselineComparison ? [`- **Retest:** ${retestSummary(report.baselineComparison)}`] : []),
    `- **Corrections:** ${report.correction ? `Replaces an earlier attempt (${compact(report.correction.reason, 60)}). Earlier results are excluded; details are in the appendix.` : 'No replacement attempt recorded.'}`, '');
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
  lines.push('', '## Recommended actions', '', 'Up to three, most serious first. Prefer the smallest change that removes the obstacle.', '');
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
  if (outsideCount) lines.push(`${outsideCount} finding(s) happened only outside the focus area; they are listed separately in the [evidence appendix](details.md).`, '');
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
  if (policy.total) lines.push(`**Blocked requests:** ${describePolicy(policy)}. All were blocked by the test's safety policy.${policy.affectsFidelity ? ' Treat findings about missing or broken content as provisional.' : ' None changed what the participant saw.'}`, '');
  if (report.limitations.some(l => /did not settle|transient visual/i.test(l))) lines.push('Some screenshots did not settle. Recheck transient visual findings before changing the design.', '');
  const rules = new Set(report.accessibility.flatMap(scan => scan.findings.map(f => f.id)));
  const errors = report.accessibility.filter(scan => scan.error).length;
  lines.push(report.platform === 'prototype' ? 'Accessibility not assessed: static images cannot be scanned.' : report.accessibility.length ? `Automated accessibility: ${rules.size} distinct rule(s) flagged${errors ? `; ${errors} scan(s) failed` : ''}. This is not a WCAG conformance audit.` : 'Automated accessibility was not assessed.', '');
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

/** True when every evidence step of a finding landed outside the run's focus paths. */
export function isOutsideFocusOnly(report: UsabilityReport, finding: UsabilityReport['findings'][number]): boolean {
  if (!report.focus?.includePaths.length) return false;
  const steps = finding.evidence.flatMap(e => e.stepNumbers.map(n => report.journeys.find(j => j.sessionId === e.sessionId)?.steps.find(s => s.step === n)));
  return steps.length > 0 && steps.every(s => s?.focus === 'outside');
}
export function prototypeTaps(report: UsabilityReport) {
  const taps = report.journeys.flatMap(j => j.steps.map(s => s.result.prototype && { ...s.result.prototype, key: `${j.sessionId}:${s.result.prototype.screenId}` })).filter(t => t !== undefined);
  // Each scored screen counts once per participant, by its first tap: right first time, or not.
  const firstTap = new Map<string, 'hit' | 'miss'>();
  for (const t of taps) if (t.target !== 'unscored' && !firstTap.has(t.key)) firstTap.set(t.key, t.target);
  return { firstTapHits: [...firstTap.values()].filter(v => v === 'hit').length, scored: firstTap.size,
    misclicks: taps.filter(t => t.target === 'miss').length, movedOn: taps.filter(t => t.movedOn).length, unscored: taps.filter(t => t.target === 'unscored').length };
}
function prototypeSummaryLine(report: UsabilityReport): string {
  const t = prototypeTaps(report);
  return `${t.scored ? `first tap on target on ${t.firstTapHits} of ${t.scored} scored screen visit(s); ${t.misclicks} misclick(s)${t.movedOn ? `; facilitator moved on ${t.movedOn} time(s)` : ''}` : 'no scored screens'}${t.unscored ? `; ${t.unscored} unscored tap(s) judged by the evaluator` : ''}. Static screens: no hover, loading, typing or scrolling.`;
}
function focusSummary(report: UsabilityReport): string {
  const focus = report.focus!;
  const outside = report.journeys.flatMap(j => j.steps).filter(s => s.focus === 'outside').length;
  const exits = report.sessions.filter(s => s.focusExit).length;
  const scope = focus.includePaths.length ? ` (${compact(focus.includePaths.join(', '), 100)})` : ' (not tracked: no page paths set)';
  return `${compact(focus.name, 80)}${scope}. ${outside} step(s) outside the focus area${exits ? `; ${exits} journey(s) ended after leaving it` : ''}. Actions below cover the focus area only.`;
}
function retestSummary(c: NonNullable<UsabilityReport['baselineComparison']>): string {
  const count = (outcome: string) => c.assessments.filter(a => a.outcome === outcome).length;
  return `Compared with baseline ${c.baselineId}${c.comparable ? '' : ` (not fully comparable: ${compact(c.mismatches.join('; '), 120)})`}: ${count('observed-again')} observed again, ${count('not-observed-on-comparable-path')} not observed on a comparable path, ${count('inconclusive')} inconclusive, ${c.newlyObserved.length} newly observed. Not observing a problem again is not proof it is fixed; participant counts are not merged.`;
}
function renderFirstImpression(report: UsabilityReport, directory: string): string {
  const screenshot = (path: string) => `[Screenshot](${relative(directory, path).split('/').map(encodeURIComponent).join('/')})`;
  const session = report.sessions[0];
  const steps = report.journeys[0]?.steps ?? [];
  const final = steps.findLast(step => step.decision.selectedAction.type === 'finish');
  const description = final?.decision.selectedAction.type === 'finish' ? final.decision.selectedAction.visibleEvidence : '';
  const lines = ['# Usability Test — First-impression exercise', '',
    `**Product:** ${compact(report.target, 160)} · **Date:** ${report.generatedAt.slice(0, 10)} · **Audience:** ${compact(session?.persona.context ?? 'unspecified', 120)}`, '',
    '**First-impression exercise — not a task outcome.** A synthetic participant looked at the starting screen (scrolling only) and described what it communicates. It is reported separately and never pooled with task journeys.', ''];
  if (report.sessions.some(s => s.provider.includes('test-double'))) lines.push('**DEMO / TEST DOUBLE — fixture verification, not AI usability research.**', '');
  lines.push('## What the starting screen communicated', '');
  if (description.trim()) lines.push(compact(description, 600), '');
  else lines.push(`No description was recorded (${compact(session?.status ?? 'unknown', 40)}: ${compact(session?.reason ?? '', 120)}).`, '');
  for (const step of steps.slice(0, 3)) if (step.decision.simulatedCommentary.trim()) lines.push(`- Simulated commentary: ${compact(step.decision.simulatedCommentary, 220)} ${screenshot(step.before.screenshot.path)}`);
  if (report.findings.length) {
    lines.push('', '## Possible clarity issues', '');
    for (const finding of report.findings.slice(0, 3)) lines.push(`- **${compact(finding.title, 80)}** — ${compact(finding.recommendation, 180)}`);
  }
  lines.push('', '## How to use this', '',
    'Compare the description with what the product intends to communicate. Mismatches are hypotheses to check with real people. This chat has now seen the product: run task tests in a fresh chat.', '',
    '[Full evidence and limitations](details.md) · [Structured report](report.json)', '');
  return lines.join('\n');
}
