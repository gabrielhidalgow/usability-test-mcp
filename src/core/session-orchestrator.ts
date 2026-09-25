import { join } from 'node:path';
import { isInFocus, sessionInputSchema, type SessionInput } from '../config/schema.js';
import { decisionSchema, interpretationSchema, type Action, type ActionResult, type Continuation, type PriorHistory, type Interpretation, type JourneyStep, type ProductObservation, type RunResult, type SessionRecord } from './types.js';
import { guardAction, isContactNavigation, safeLocation } from './safety.js';
import { sessionReport } from './synthesis.js';
import { BrowserWindowClosed, type ProductDriver } from '../drivers/product-driver.js';
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
    case 'tap_point': if (!driver.tapPoint) throw new Error('Coordinate tapping is unavailable'); return driver.tapPoint(action.x, action.y);
    case 'enter_text': if (!driver.enterText) throw new Error('Native text input is unavailable'); return driver.enterText(action.value);
    case 'click': return driver.click({ ref: action.target });
    case 'tap': return driver.tap({ ref: action.target });
    case 'type': return driver.type({ ref: action.target }, action.value);
    case 'scroll': return driver.scroll(action.direction);
    case 'key': return driver.pressKey(action.key);
    case 'back': return driver.goBack();
    case 'finish': return { ok: true, message: action.reason };
  }
}

class PolicyBlocked extends Error {}

export class SessionOrchestrator {
  constructor(private readonly recorder: EvidenceRecorder, private readonly driverFactory: (input: SessionInput) => ProductDriver) {}

  async run(rawInput: unknown, provider: ReasoningProvider, externalSignal?: AbortSignal, onCreated?: (id: string) => void | Promise<void>, context?: { continuation: Continuation; priorHistory: PriorHistory[] }): Promise<RunResult> {
    const input = sessionInputSchema.parse(rawInput);
    const { id, paths } = await this.recorder.create('session');
    await onCreated?.(id);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('Session deadline exceeded')), input.timeoutMs);
    const windowClosed = new AbortController();
    const signal = AbortSignal.any([deadline.signal, windowClosed.signal, ...(externalSignal ? [externalSignal] : [])]);
    const driver = this.driverFactory(input);
    const record: SessionRecord = { id, kind: 'session', startedAt: new Date().toISOString(), finishedAt: '',
      continuation: context?.continuation, input: { ...input, target: input.platform === 'web' ? safeLocation(input.target) : input.target }, provider: provider.name, status: 'incomplete',
      reason: 'Session has not completed', actions: 0, journey: [], accessibility: [], warnings: [...(provider.limitations ?? []), ...(driver.limitations ?? [])] };
    if (context) record.warnings.push('Continuation segment: browser cookies, storage, form values, scroll position and navigation history were reset. Prior actions were not replayed; this is not a new independent participant.');
    let interpretations: Interpretation[] = [];
    let stage = 'startup';
    const collectPolicy = (stopOnBlock = true) => {
      const events = driver.takePolicyDiagnostics?.() ?? [];
      record.policyDiagnostics ??= [];
      record.policyDiagnostics.push(...events.map(event => ({ ...event, step: record.actions })));
      if (events.some(e => !e.stopsJourney) && !record.warnings.includes('Background resources were blocked by safety policy; rendered content may differ from a normal browser.')) {
        record.warnings.push('Background resources were blocked by safety policy; rendered content may differ from a normal browser.');
      }
      const fatal = events.find(e => e.stopsJourney);
      if (fatal) {
        const message = `Session safety policy blocked ${fatal.reason} (${fatal.phase}).`;
        const step = record.journey.at(-1);
        if (step) step.result = { ok: false, blocked: true, message };
        if (stopOnBlock) throw new PolicyBlocked(message);
        if (!['error', 'cancelled', 'timeout'].includes(record.status)) { record.status = 'blocked'; record.reason = message; }
      }
    };
    const run = <T>(fn: () => Promise<T>) => withAbort(fn, signal);
    const scan = async (observation: ProductObservation, step: number) => {
      if (!input.accessibilityChecks) return;
      stage = 'accessibility';
      const result = await run(() => driver.scanAccessibility(step, observation.screenshot.path));
      record.accessibility.push(result);
      await this.recorder.json(join(paths.directory, 'accessibility', `${String(step).padStart(4, '0')}.json`), result);
    };
    try {
      await run(() => driver.start({ input, directory: paths.directory, signal, onWindowClosed: () => windowClosed.abort(new BrowserWindowClosed('Browser window closed by viewer')) }));
      stage = 'observation';
      let observation = await run(() => driver.getObservation());
      record.initialObservation = observation;
      if (observation.capture && !observation.capture.settled) record.warnings.push('Initial capture did not settle within its time budget; transient visual findings need rechecking.');
      const tracksFocus = Boolean(input.focus?.includePaths.length);
      let outsideStreak = 0;
      if (tracksFocus && !isInFocus(input.focus, observation.location)) record.warnings.push(`The start page is outside the focus area "${input.focus!.name}". Check the focus start page and paths.`);
      collectPolicy();
      await this.recorder.checkpoint(record);
      await scan(observation, 0);
      while (true) {
        collectPolicy();
        stage = 'participant-reasoning';
        await driver.setViewStatus?.({ participant: input.persona.name, step: record.journey.length + 1, phase: 'waiting' });
        const decision = decisionSchema.parse(await run(() => provider.decideNextAction({
          environmentWarnings: record.policyDiagnostics?.some(d => !d.stopsJourney) ? ['Reduced fidelity: background requests were blocked. Their purpose is unknown. Judge only the visible interface; missing content may be a harness restriction, not a product defect.'] : [],
          sessionId: id, presentation: input.presentation, continuation: context?.continuation, priorHistory: context?.priorHistory,
          persona: input.persona, scenario: input.scenario, goal: input.goal, interactionMode: input.interactionMode, exercise: input.exercise,
          observation, history: record.journey, signal,
        })));
        collectPolicy();
        const action = decision.selectedAction;
        await driver.setViewStatus?.({ participant: input.persona.name, step: record.journey.length + 1, phase: 'planned', action: action.type });
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
        stage = 'action';
        await driver.setViewStatus?.({ participant: input.persona.name, step: step.step, phase: 'executing', action: action.type });
        step.result = await run(() => execute(driver, isContactNavigation(action, observation) ? { ...action, capability: null } as Action : action));
        await driver.setViewStatus?.({ participant: input.persona.name, step: step.step, phase: 'completed', action: action.type });
        stage = 'observation';
        observation = await run(() => driver.getObservation());
        step.after = observation;
        if (observation.capture && !observation.capture.settled) record.warnings.push(`Capture after action ${record.actions} did not settle; transient visual findings need rechecking.`);
        if (tracksFocus) {
          step.focus = isInFocus(input.focus, observation.location) ? 'inside' : 'outside';
          outsideStreak = step.focus === 'outside' ? outsideStreak + 1 : 0;
        }
        collectPolicy();
        driver.setActionCapability(null);
        await this.recorder.checkpoint(record);
        if (step.result.blocked) {
          record.status = 'blocked'; record.reason = step.result.message; break;
        }
        // Leaving the focus is recorded, not prevented; a sustained exit ends the journey as its own finding.
        if (tracksFocus && outsideStreak >= input.focus!.leaveLimit) {
          record.status = 'incomplete'; record.focusExit = true;
          record.reason = `Left the focus area (${outsideStreak} consecutive steps outside "${input.focus!.name}")`;
          break;
        }
        await scan(observation, record.actions);
      }
    } catch (error) {
      if (!(error instanceof PolicyBlocked)) record.failureStage = stage;
      record.status = error instanceof PolicyBlocked ? 'blocked' : externalSignal?.aborted || windowClosed.signal.aborted ? 'cancelled' : deadline.signal.aborted ? 'timeout' : 'error';
      record.reason = error instanceof PolicyBlocked ? error.message : record.status === 'cancelled' ? (windowClosed.signal.aborted ? 'Browser window closed by viewer; partial evidence retained' : 'Session cancelled by caller') : record.status === 'timeout'
        ? 'Session deadline exceeded' : `Session could not continue during ${stage}; inspect the saved journey and local setup.`;
      if (error instanceof Error && (error.message.startsWith('Browser startup') || error.message.startsWith('Browser display') || error.message.startsWith('Native setup:'))) record.reason = error.message;
    } finally {
      await driver.setViewStatus?.({ participant: input.persona.name, step: record.journey.length, phase: 'finished' });
      if (input.presentation === 'visible' && !signal.aborted) await new Promise(resolve => setTimeout(resolve, 500));
      driver.setActionCapability(null);
      await driver.stop();
      collectPolicy(false);
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
