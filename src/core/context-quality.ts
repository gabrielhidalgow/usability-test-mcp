import type { SessionInput } from '../config/schema.js';
import type { UsabilityReport } from './types.js';

export function assertParticipantContext(input: Pick<SessionInput, 'contextCheck' | 'handoff'> & { platform?: SessionInput['platform'] }) {
  const check = input.contextCheck;
  // Whoever imported a prototype has seen every frame and target, so the run must declare its context.
  if (input.platform === 'prototype' && !check) throw new Error('Prototype tests require contextCheck. Run the participant in a fresh chat or agent that has not seen the frames (mode first-visit, isolation host-reported fresh), or declare an informed-walkthrough.');
  if (!check) return; // Older clients remain usable, with unverified first-visit conclusions withheld.
  if (check.mode === 'first-visit' && (check.isolation !== 'host-reported fresh' || check.exposure.length)) {
    throw new Error('First-visit testing requires a clean participant context with no source-code, discovery, prior-findings or prior-journey exposure. Start a fresh chat/agent with only the neutral task and profile. Alternatively explicitly choose informed-walkthrough; its results cannot support first-visit conclusions. Freshness is host-reported, not verified.');
  }
  if (input.handoff && (check.isolation !== 'host-reported fresh' || check.exposure.length)) {
    throw new Error('Discovery-assisted tests still require a clean participant context; informed-walkthrough does not bypass the discovery handoff.');
  }
}
export function contextQuality(report: UsabilityReport, session: UsabilityReport['sessions'][number]) {
  const declarations = report.journeys.find(j => j.sessionId === session.id)?.steps.map(s => s.decision.contextIsolation) ?? [];
  const check = session.contextCheck;
  const contaminated = Boolean(check?.exposure.length) || check?.mode === 'informed-walkthrough' || check?.isolation === 'shared' || declarations.includes('shared');
  const fresh = !contaminated && declarations[0] === 'host-reported fresh' && (!check || check.isolation === 'host-reported fresh');
  return { isolation: contaminated ? 'shared' : fresh ? 'host-reported fresh' : 'unknown',
    method: contaminated ? 'informed walkthrough' : fresh ? 'fresh-context simulation' : 'context-unverified simulation',
    firstVisitSupported: fresh };
}
