import type { Action, Interpretation, ParticipantDecision, SessionRecord, UsabilityReport } from '../../src/core/types.js';
import type { ParticipantDecisionInput, ReasoningProvider } from '../../src/reasoning/provider.js';
import { synthesizeReports } from '../../src/core/synthesis.js';

export function makeDecision(action: Action, commentary = 'Test-double decision from current UI'): ParticipantDecision {
  return { stateSummary: 'Fixture interface observed', simulatedCommentary: commentary, userExpectation: null,
    selectedAction: action, confidence: 0.8, friction: null, behavior: 'progress' };
}
// A fixture-aware reactive test double, NOT an AI participant and never available in production configuration.
export class FixtureProvider implements ReasoningProvider {
  readonly name = 'deterministic-fixture-test-double (not AI research)';
  async decideNextAction(input: ParticipantDecisionInput): Promise<ParticipantDecision> {
    const observation = input.observation;
    if (observation.visibleText.includes('Set up your workspace')) return makeDecision({ type: 'finish', outcome: 'completed',
      reason: 'Fixture setup reached', visibleEvidence: 'Set up your workspace; Starter plan: $12 per month.' });
    const candidate = observation.candidates.find(c => c.name === 'Options' || c.name === 'Try this plan');
    if (!candidate) return makeDecision({ type: 'finish', outcome: 'incomplete', reason: 'Fixture control unavailable', visibleEvidence: observation.visibleText });
    let action: Action = { type: 'click', target: candidate.ref, capability: null };
    if (input.interactionMode === 'keyboard') {
      action = observation.semantics.focused?.includes(candidate.name)
        ? { type: 'key', key: 'Enter', capability: null } : { type: 'key', key: 'Tab', capability: null };
    }
    const decision = makeDecision(action, candidate.name === 'Options' ? 'I expect pricing, but this link says Options.' : 'The plan price is visible.');
    if (candidate.name === 'Options') {
      decision.behavior = 'hesitation'; decision.friction = { category: 'navigation', description: 'Options does not name pricing' };
    }
    return decision;
  }
  async evaluateObservation({ session }: { session: SessionRecord; signal: AbortSignal }): Promise<Interpretation[]> {
    const step = session.journey.find(s => s.decision.friction);
    return step ? [{ title: 'Pricing is hidden behind Options', category: 'navigation', stepNumbers: [step.step],
      likelyUsabilityProblem: 'The label may make pricing harder to recognize.', recommendation: 'Use a label that names the pricing destination.',
      taskImpact: 'minor-delay', confidence: 'medium' }] : [];
  }
  async synthesizeReport({ sessions, id }: { sessions: UsabilityReport[]; id: string }) { return synthesizeReports(sessions, id); }
}
