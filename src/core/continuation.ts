import { z } from 'zod';
import { sessionInputSchema, isHttpUrlWithoutCredentials } from '../config/schema.js';
import { artifactIdSchema, type EvidenceRecorder } from '../evidence/recorder.js';
import { decisionSchema, type Continuation, type PriorHistory } from './types.js';
export class ContinuationError extends Error {}
const locationSchema = z.object({ location: z.string() });
const savedSchema = z.object({
  id: artifactIdSchema, kind: z.literal('session'), input: sessionInputSchema,
  status: z.enum(['completed', 'incomplete', 'blocked', 'timeout', 'cancelled', 'error']),
  initialObservation: locationSchema.optional(),
  continuation: z.object({ previousSessionId: artifactIdSchema, rootSessionId: artifactIdSchema }).optional(),
  journey: z.array(z.object({ step: z.number().int().positive(), decision: decisionSchema,
    result: z.object({ ok: z.boolean(), message: z.string(), blocked: z.boolean().optional() }),
    before: locationSchema, after: locationSchema.optional() })),
});
export async function prepareContinuation(recorder: EvidenceRecorder, id: string, options: { timeoutMs?: number; accessibilityChecks?: boolean } = {}) {
  if (!id.startsWith('session-')) throw new ContinuationError('Select an individual session ID, not a round.');
  try {
    const summary = JSON.parse(await recorder.read(id, 'json'));
    if (summary.supersededBy) throw new ContinuationError(`This run was superseded by ${summary.supersededBy}; do not continue the discarded attempt.`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const previous = savedSchema.parse(JSON.parse(await recorder.read(id, 'journey')));
  if (previous.id !== id || previous.status === 'completed') throw new ContinuationError('Only interrupted or incomplete sessions can be continued.');
  if (previous.input.platform !== 'web') throw new ContinuationError('Native continuation is not supported; prepare the device and start a new labelled session.');
  const latest = previous.journey.at(-1);
  const location = latest?.after?.location ?? latest?.before.location ?? previous.initialObservation?.location;
  if (!location || !isHttpUrlWithoutCredentials(location) || new URL(location).origin !== new URL(previous.input.target).origin) throw new ContinuationError('No safe same-origin observed location is available. Start a fresh test.');
  const history: PriorHistory[] = [];
  let record = previous;
  const seen = new Set<string>();
  while (true) {
    if (seen.has(record.id) || seen.size >= 10) throw new ContinuationError('Continuation history is cyclic or exceeds ten segments. Start a fresh test.');
    seen.add(record.id);
    if (JSON.stringify(record.input.persona) !== JSON.stringify(previous.input.persona) || record.input.goal !== previous.input.goal || record.input.scenario !== previous.input.scenario) throw new ContinuationError('Continuation history does not match this participant and task.');
    history.unshift({ sessionId: record.id, steps: record.journey.slice(-20).map(({step,decision,result,after}) => ({ step, decision,
      result: !after && !result.blocked && decision.selectedAction.type !== 'finish' ? { ok: false, message: 'Outcome unknown after interruption; do not replay automatically.' } : result })) });
    if (!record.continuation) break;
    const parentId = record.continuation.previousSessionId;
    record = savedSchema.parse(JSON.parse(await recorder.read(parentId, 'journey')));
    if (record.id !== parentId) throw new ContinuationError('Invalid continuation lineage.');
  }
  const continuation: Continuation = { previousSessionId: id, rootSessionId: history[0]!.sessionId,
    previousStatus: previous.status, browserStateRestored: false,
    uncertainAction: Boolean(latest && latest.decision.selectedAction.type !== 'finish' && !latest.after && !latest.result.blocked) };
  // Never replay an action or carry forward a consequential-action override.
  const input = sessionInputSchema.parse({ ...previous.input, rerun: undefined, target: location, timeoutMs: options.timeoutMs ?? 600000,
    accessibilityChecks: options.accessibilityChecks ?? previous.input.accessibilityChecks,
    testEnvironment: false, allowedCapabilities: [] });
  return { input, context: { continuation, priorHistory: history } };
}
