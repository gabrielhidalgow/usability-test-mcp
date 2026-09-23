import { randomUUID } from 'node:crypto';
import { decisionSchema, interpretationSchema, type Continuation, type PriorHistory, type RunResult, type UsabilityReport, type ArtifactPaths } from './types.js';
import { roundInputSchema, sessionInputSchema } from '../config/schema.js';
import { HostReasoningProvider, type PendingRequest } from '../reasoning/host.js';
import { RoundOrchestrator } from './round-orchestrator.js';
import { SessionOrchestrator, withAbort } from './session-orchestrator.js';

export class HostSessionError extends Error {}
type Finished = { id: string; status: string; report: UsabilityReport; paths: ArtifactPaths };
type Job = {
  id?: string; controller: AbortController; pending?: PendingRequest; finished?: Finished;
  failed: boolean; busy: boolean; changed: ReturnType<typeof Promise.withResolvers<void>>; done: Promise<void>;
};
export type HostState =
  | { runId: string; phase: 'running' }
  | { runId: string; phase: 'finished'; result: Finished }
  | { runId: string; phase: 'error'; error: string }
  | { runId: string; phase: 'awaiting_decision' | 'awaiting_findings'; pending: PendingRequest };

// The async orchestrator pauses at provider boundaries. Ordinary host tool calls resume it;
// no model API or MCP sampling requests are issued by this process.
export class HostSessions {
  private readonly jobs = new Map<string, Job>();
  private closed = false;
  constructor(private readonly sessions: SessionOrchestrator, private readonly rounds: RoundOrchestrator) {}

  private notify(job: Job) { const prior = job.changed; job.changed = Promise.withResolvers<void>(); prior.resolve(); }
  private state(job: Job): HostState {
    const runId = job.id ?? '';
    if (job.failed) return { runId, phase: 'error', error: 'Session execution failed. Check local artifact storage and browser setup.' };
    if (job.finished) return { runId, phase: 'finished', result: job.finished };
    if (job.pending) return { runId, phase: job.pending.phase, pending: job.pending };
    return { runId, phase: 'running' };
  }
  private async wait(job: Job): Promise<HostState> {
    while (!job.pending && !job.finished && !job.failed) await job.changed.promise;
    return this.state(job);
  }
  private get(id: string): Job {
    const job = [...this.jobs.values()].find(j => j.id === id);
    if (!job) throw new HostSessionError('Run not active or no longer cached. Use usability_get_report for saved artifacts; start a new session after a server restart.');
    return job;
  }
  private async requestScope<T>(job: Job, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const abort = () => job.controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    try { return signal ? await withAbort(operation, signal) : await operation(); }
    finally { signal?.removeEventListener('abort', abort); }
  }
  async start(kind: 'session' | 'round', raw: unknown, signal?: AbortSignal, context?: { continuation: Continuation; priorHistory: PriorHistory[] }): Promise<HostState> {
    if (this.closed) throw new HostSessionError('The server is shutting down.');
    const input = kind === 'session' ? sessionInputSchema.parse(raw) : roundInputSchema.parse(raw);
    if ([...this.jobs.values()].filter(j => !j.finished && !j.failed).length >= 4) {
      throw new HostSessionError('Four runs are already active. Finish or cancel one before starting another.');
    }
    for (const [key, job] of this.jobs) {
      if (this.jobs.size < 24) break;
      if (job.finished || job.failed) this.jobs.delete(key);
    }
    const job: Job = { controller: new AbortController(), failed: false, busy: false,
      changed: Promise.withResolvers<void>(), done: Promise.resolve() };
    this.jobs.set(randomUUID(), job);
    const provider = () => new HostReasoningProvider(pending => { job.pending = pending; this.notify(job); });
    const created = (id: string) => { job.id = id; };
    const task = kind === 'session'
      ? this.sessions.run(input, provider(), job.controller.signal, created, context).then((run: RunResult) => ({
        id: run.session.id, status: run.session.status, report: run.report, paths: run.paths,
      }))
      : this.rounds.run(input, provider, job.controller.signal, created);
    job.done = task.then(finished => { job.pending = undefined; job.finished = finished; this.notify(job); },
      () => { job.pending = undefined; job.failed = true; this.notify(job); });
    return this.requestScope(job, signal, () => this.wait(job));
  }
  isActive(id: string): boolean { return [...this.jobs.values()].some(j => j.id === id && !j.finished && !j.failed); }
  getState(id: string): HostState { return this.state(this.get(id)); }

  async advance(id: string, requestId: string, raw: unknown, signal?: AbortSignal): Promise<HostState> {
    const decision = decisionSchema.parse(raw);
    const job = this.get(id);
    const pending = job.pending;
    if (job.busy || !pending || pending.phase !== 'awaiting_decision' || pending.requestId !== requestId) {
      throw new HostSessionError('Stale or already-consumed decision request. Call usability_get_session_state; never replay an action blindly.');
    }
    job.busy = true; job.pending = undefined;
    try {
      return await this.requestScope(job, signal, async () => { pending.submit(decision); return this.wait(job); });
    } finally { job.busy = false; }
  }
  async findings(id: string, requestId: string, raw: unknown, signal?: AbortSignal): Promise<HostState> {
    const findings = interpretationSchema.array().max(8).parse(raw);
    const job = this.get(id); const pending = job.pending;
    if (job.busy || !pending || pending.phase !== 'awaiting_findings' || pending.requestId !== requestId) {
      throw new HostSessionError('Stale or unexpected findings request. Call usability_get_session_state.');
    }
    job.busy = true; job.pending = undefined;
    try {
      return await this.requestScope(job, signal, async () => { pending.submit(findings); return this.wait(job); });
    } finally { job.busy = false; }
  }
  async cancel(id: string): Promise<HostState> {
    const job = this.get(id);
    job.controller.abort();
    await job.done;
    return this.state(job);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.all([...this.jobs.values()].map(j => j.done));
  }
}
