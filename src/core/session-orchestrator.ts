import { join } from 'node:path';
import { sessionInputSchema, type SessionInput } from '../config/schema.js';
import { decisionSchema, interpretationSchema, type Action, type ActionResult, type Interpretation, type JourneyStep, type ProductObservation, type RunResult, type SessionRecord } from './types.js';
import { guardAction, safeLocation } from './safety.js';
import { sessionReport } from './synthesis.js';
import type { ProductDriver } from '../drivers/product-driver.js';
import type { ReasoningProvider } from '../reasoning/provider.js';
import { EvidenceRecorder } from '../evidence/recorder.js';

export async function withAbort<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('Cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([operation(), cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

async function execute(driver: ProductDriver, action: Action): Promise<ActionResult> {
  driver.setActionCapability('capability' in action ? action.capability : null);
  switch (action.type) {
    case 'click': return driver.click({ ref: action.target });
    case 'tap': return driver.tap({ ref: action.target });
    case 'type': return driver.type({ ref: action.target }, action.value);
    case 'scroll': return driver.scroll(action.direction);
    case 'key': return driver.pressKey(action.key);
    case 'back': return driver.goBack();
    case 'finish': return { ok: true, message: action.reason };
  }
}

export class SessionOrchestrator {
  constructor(private readonly recorder: EvidenceRecorder, private readonly driverFactory: () => ProductDriver) {}

  async run(rawInput: unknown, provider: ReasoningProvider, externalSignal?: AbortSignal, onCreated?: (id: string) => void): Promise<RunResult> {
    const input = sessionInputSchema.parse(rawInput);
    const { id, paths } = await this.recorder.create('session');
    onCreated?.(id);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('Session deadline exceeded')), input.timeoutMs);
    const signal = externalSignal ? AbortSignal.any([deadline.signal, externalSignal]) : deadline.signal;
    const driver = this.driverFactory();
    const record: SessionRecord = { id, kind: 'session', startedAt: new Date().toISOString(), finishedAt: '',
      input: { ...input, target: safeLocation(input.target) }, provider: provider.name, status: 'incomplete',
      reason: 'Session has not completed', actions: 0, journey: [], accessibility: [], warnings: [...(provider.limitations ?? [])] };
    let interpretations: Interpretation[] = [];
    const run = <T>(fn: () => Promise<T>) => withAbort(fn, signal);
    const scan = async (observation: ProductObservation, step: number) => {
      if (!input.accessibilityChecks) return;
      const result = await run(() => driver.scanAccessibility(step, observation.screenshot.path));
      record.accessibility.push(result);
      await this.recorder.json(join(paths.directory, 'accessibility', `${String(step).padStart(4, '0')}.json`), result);
    };
    try {
      await run(() => driver.start({ input, directory: paths.directory, signal }));
      let observation = await run(() => driver.getObservation());
      record.initialObservation = observation;
      await this.recorder.checkpoint(record);
      await scan(observation, 0);
      while (true) {
        const decision = decisionSchema.parse(await run(() => provider.decideNextAction({
          sessionId: id,
          persona: input.persona, scenario: input.scenario, goal: input.goal, interactionMode: input.interactionMode,
          observation, history: record.journey, signal,
        })));
        const action = decision.selectedAction;
        const step: JourneyStep = { step: record.journey.length + 1, before: observation, decision,
          result: { ok: false, message: 'Action not executed' } };
        record.journey.push(step);
        if (action.type === 'finish') {
          const validCompletion = action.outcome !== 'completed' || action.visibleEvidence.trim().length > 0;
          record.status = validCompletion ? action.outcome : 'incomplete';
          record.reason = validCompletion ? action.reason : 'The participant supplied no visible completion evidence';
          step.result = { ok: validCompletion, message: `${record.reason}. Visible evidence (model judgment): ${action.visibleEvidence}` };
          break;
        }
        if (record.actions >= input.maxActions) {
          record.reason = 'Maximum action limit reached';
          step.result.message = record.reason;
          break;
        }
        const block = guardAction(action, observation, input);
        if (block) {
          step.result = { ok: false, blocked: true, message: block };
          record.status = 'blocked'; record.reason = block;
          break;
        }
        // Save the intended action before execution so failures retain the evidence trail.
        await this.recorder.checkpoint(record);
        record.actions++;
        step.result = await run(() => execute(driver, action));
        observation = await run(() => driver.getObservation());
        step.after = observation;
        driver.setActionCapability(null);
        await this.recorder.checkpoint(record);
        if (step.result.blocked) {
          record.status = 'blocked'; record.reason = step.result.message; break;
        }
        await scan(observation, record.actions);
      }
    } catch (error) {
      record.status = externalSignal?.aborted ? 'cancelled' : deadline.signal.aborted ? 'timeout' : 'error';
      record.reason = record.status === 'cancelled' ? 'Session cancelled by caller' : record.status === 'timeout'
        ? 'Session deadline exceeded' : 'Session could not continue: browser, target, or reasoning provider unavailable or invalid output.';
      if (error instanceof Error && error.message.startsWith('Browser startup')) record.reason = error.message;
    } finally {
      driver.setActionCapability(null);
      await driver.stop();
    }
    // Interpretation cannot turn an infrastructure failure into a product usability finding.
    if (!signal.aborted && !['error', 'blocked'].includes(record.status) && record.journey.some(s => s.result.ok)) {
      try { interpretations = interpretationSchema.array().max(8).parse(await run(() => provider.evaluateObservation({ session: record, signal }))); }
      catch { record.warnings.push('Interpretation did not complete; consult the recorded journey.'); }
    }
    clearTimeout(timer);
    record.finishedAt = new Date().toISOString();
    await this.recorder.checkpoint(record);
    const report = sessionReport(record, interpretations);
    await this.recorder.finish(report);
    return { session: record, report, paths };
  }
}
