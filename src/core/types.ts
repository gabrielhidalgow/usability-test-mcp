import { z } from 'zod';
import { capabilitySchema, type Persona, type SessionInput } from '../config/schema.js';
import { principleIdsSchema } from '../methodology/principles.js';

export const categorySchema = z.enum(['navigation', 'comprehension', 'affordance', 'content', 'form',
  'feedback', 'error-recovery', 'trust', 'accessibility', 'visual-hierarchy', 'other']);
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('tap_point'), x: z.number().min(0).max(1), y: z.number().min(0).max(1), visibleLabel: z.string().min(1).max(300), capability: capabilitySchema.nullable() }),
  z.strictObject({ type: z.literal('enter_text'), value: z.string().max(2000).refine(v => !v.includes('${'), 'Maestro expressions are not allowed'), visibleLabel: z.string().min(1).max(300), capability: capabilitySchema.nullable() }),
  z.strictObject({ type: z.literal('click'), target: z.string(), capability: capabilitySchema.nullable() }),
  z.strictObject({ type: z.literal('tap'), target: z.string(), capability: capabilitySchema.nullable() }),
  z.strictObject({ type: z.literal('type'), target: z.string(), value: z.string().max(2000), capability: capabilitySchema.nullable() }),
  z.strictObject({ type: z.literal('scroll'), direction: z.enum(['up', 'down', 'left', 'right']) }),
  z.strictObject({ type: z.literal('key'), key: z.enum(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']), capability: capabilitySchema.nullable() }),
  z.strictObject({ type: z.literal('back') }),
  z.strictObject({ type: z.literal('finish'), outcome: z.enum(['completed', 'incomplete', 'blocked']), reason: z.string(), visibleEvidence: z.string() }),
]);
export const isolationSchema = z.enum(['shared', 'host-reported fresh', 'unknown']);
export const decisionSchema = z.strictObject({
  contextIsolation: isolationSchema.optional(),
  stateSummary: z.string().max(2000),
  simulatedCommentary: z.string().max(2000),
  userExpectation: z.string().max(1000).nullable(),
  selectedAction: actionSchema,
  confidence: z.number().min(0).max(1),
  friction: z.strictObject({ category: categorySchema, description: z.string().max(2000) }).nullable(),
  behavior: z.enum(['progress', 'hesitation', 'wrong-turn', 'backtracking', 'misunderstanding']),
});
export type ParticipantDecision = z.infer<typeof decisionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type InteractionTarget = { ref: string };
export type EvidenceArtifact = { path: string; mimeType: 'image/png' };
export type Candidate = {
  ref: string; role: string; name: string; disabled: boolean;
  contactNavigation?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
};
export type AccessibilitySnapshot = { tree: string; focused: string | null; focusedRef?: string };
export type ProductObservation = {
  timestamp: string; location: string; title: string; visibleText: string;
  semantics: AccessibilitySnapshot; candidates: Candidate[];
  viewport: { width: number; height: number }; screenshot: EvidenceArtifact;
  dialogs: string[];
  capture?: { settled: boolean; waitedMs: number; reason: string };
};
export type PolicyDiagnostic = {
  requestContext?: 'before-first-interaction' | 'after-interaction' | 'main-navigation';
  destination?: 'same-origin' | 'cross-origin';
  reason: 'unsupported-protocol' | 'credentialed-url' | 'cross-origin-navigation' | 'capability-denied' | 'mutation-denied';
  phase: 'request' | 'redirect'; method: string; resourceType: string;
  mainFrameNavigation: boolean; stopsJourney: boolean;
};
export type ActionResult = { ok: boolean; message: string; blocked?: boolean };
export type AxeFinding = { id: string; impact: string | null; description: string; helpUrl: string; targets: string[] };
export type AccessibilityScan = { step: number; screenshot: string; findings: AxeFinding[]; error?: string };
export type JourneyStep = {
  step: number; before: ProductObservation; decision: ParticipantDecision;
  result: ActionResult; after?: ProductObservation;
};
export const suggestedChangeSchema = z.strictObject({
  kind: z.enum(['copy', 'design', 'interaction']),
  location: z.string().trim().min(1).max(160),
  proposal: z.string().trim().min(1).max(400),
  verify: z.string().trim().min(1).max(240),
  replacement: z.strictObject({ before: z.string().trim().min(1).max(200), after: z.string().trim().min(1).max(200) }).optional(),
});
export type SuggestedChange = z.infer<typeof suggestedChangeSchema>;
export const interpretationSchema = z.strictObject({
  suggestedChange: suggestedChangeSchema.optional(),
  principleIds: principleIdsSchema.optional(),
  category: categorySchema, title: z.string(), stepNumbers: z.array(z.number().int().positive()).min(1),
  likelyUsabilityProblem: z.string(), recommendation: z.string(),
  taskImpact: z.enum(['blocked', 'major-delay', 'minor-delay', 'no-task-impact']),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type Interpretation = z.infer<typeof interpretationSchema>;
export type UsabilityIssue = Interpretation & {
  id: string; severity: 'critical' | 'high' | 'medium' | 'low'; observedBehaviour: string;
  participantsAffected: string[];
  evidence: { sessionId: string; stepNumbers: number[]; screenshots: string[] }[];
};
export type SessionStatus = 'completed' | 'incomplete' | 'blocked' | 'timeout' | 'cancelled' | 'error';
export type Continuation = { previousSessionId: string; rootSessionId: string; previousStatus: SessionStatus; browserStateRestored: false; uncertainAction: boolean };
export type PriorHistory = { sessionId: string; steps: Pick<JourneyStep, 'step' | 'decision' | 'result'>[] };
export type SessionRecord = {
  id: string; kind: 'session'; startedAt: string; finishedAt: string;
  input: SessionInput; provider: string; status: SessionStatus; reason: string;
  actions: number; journey: JourneyStep[]; initialObservation?: ProductObservation;
  accessibility: AccessibilityScan[]; warnings: string[];
  policyDiagnostics?: (PolicyDiagnostic & { step: number })[];
  failureStage?: string;
  continuation?: Continuation;
};
export type UsabilityReport = {
  id: string; kind: 'session' | 'round'; synthetic: true; generatedAt: string;
  methodologyVersion?: string; exercise?: 'task' | 'first-impression';
  baselineComparison?: import('./run-comparison.js').BaselineComparison;
  platform?: 'web' | 'native'; viewport?: 'desktop' | 'mobile'; target: string; scenario: string; goal: string; disclaimer: string;
  sessions: { id: string; persona: Persona; status: SessionStatus; reason: string;
    continuation?: Continuation; presentation?: 'visible' | 'background'; handoff?: SessionInput['handoff']; contextCheck?: SessionInput['contextCheck']; actions: number; wrongTurns: number; backtracks: number; provider: string }[];
  correction?: { priorRunId: string; reason: string; changes: string; recordedAt: string; changedFields: string[] };
  supersededBy?: string;
  comparison?: import('./comparison.js').Comparison;
  findings: UsabilityIssue[]; accessibility: (AccessibilityScan & { sessionId: string })[];
  journeys: { sessionId: string; steps: JourneyStep[] }[];
  limitations: string[];
  policyDiagnostics?: (PolicyDiagnostic & { step: number; sessionId: string })[];
};
export type RunResult = { session: SessionRecord; report: UsabilityReport; paths: ArtifactPaths };
export type ArtifactPaths = { directory: string; report: string; details: string; json: string; journey: string };
