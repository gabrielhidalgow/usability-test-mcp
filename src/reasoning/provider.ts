import type { Persona } from '../config/schema.js';
import type { Interpretation, JourneyStep, ParticipantDecision, ProductObservation, SessionRecord, UsabilityReport } from '../core/types.js';

export type ParticipantDecisionInput = {
  sessionId: string;
  persona: Persona; scenario: string; goal: string; interactionMode: 'standard' | 'keyboard';
  observation: ProductObservation; history: JourneyStep[]; signal: AbortSignal;
};
export interface ReasoningProvider {
  readonly name: string;
  readonly limitations?: string[];
  decideNextAction(input: ParticipantDecisionInput): Promise<ParticipantDecision>;
  evaluateObservation(input: { session: SessionRecord; signal: AbortSignal }): Promise<Interpretation[]>;
  synthesizeReport(input: { sessions: UsabilityReport[]; id: string }): Promise<UsabilityReport>;
}
