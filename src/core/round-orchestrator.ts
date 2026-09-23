import { roundInputSchema, personaSchema } from '../config/schema.js';
import type { UsabilityReport } from './types.js';
import { EvidenceRecorder } from '../evidence/recorder.js';
import type { ReasoningProvider } from '../reasoning/provider.js';
import { SessionOrchestrator } from './session-orchestrator.js';
import { initializeComparison } from './comparison.js';
import { synthesizeReports } from './synthesis.js';

export class RoundOrchestrator {
  constructor(private readonly recorder: EvidenceRecorder, private readonly sessions: SessionOrchestrator) {}
  async run(rawInput: unknown, providerFactory: () => ReasoningProvider, signal?: AbortSignal, onCreated?: (id: string) => void) {
    const input = roundInputSchema.parse(rawInput);
    const { id, paths } = await this.recorder.create('round');
    onCreated?.(id);
    const { personas: supplied, participantCount, personaContext, ...shared } = input;
    const variations = [
      { technicalConfidence: 'average', constraints: ['using the product for the first time', 'limited time to scan the interface'] },
      { technicalConfidence: 'low', constraints: ['using the product for the first time', 'unfamiliar with this product category'] },
      { technicalConfidence: 'high', constraints: ['using the product for the first time', 'wants to compare available choices'] },
      { technicalConfidence: 'average', constraints: ['using the product for the first time', 'needs to understand terms before committing'] },
      { technicalConfidence: 'low', constraints: ['using the product for the first time', 'prefers concise plain-language instructions'] },
    ];
    const personas = supplied ?? Array.from({ length: participantCount }, (_, i) => personaSchema.parse({
      name: `Participant ${i + 1}`, context: personaContext, productKnowledge: i === 2 ? 'some' : 'none', basis: 'assumption', informationNeeds: [i === 0 ? 'A concise explanation of available choices' : i === 1 ? 'Plain-language explanations of unfamiliar terms' : 'Enough detail to compare choices'], ...variations[i],
    }));
    const reports: UsabilityReport[] = [];
    await this.recorder.json(paths.journey, { id, kind: 'round', input, sessionIds: [], status: 'running' });
    for (const persona of personas) {
      if (signal?.aborted && reports.length) break;
      // Browser/provider objects are fresh. A host chat must manage its own model-context isolation.
      const provider = providerFactory();
      const run = await this.sessions.run({ ...shared, persona }, {
        name: provider.name, limitations: provider.limitations,
        decideNextAction: input => provider.decideNextAction(input),
        evaluateObservation: async () => [],
        synthesizeReport: input => provider.synthesizeReport(input),
      }, signal);
      reports.push(run.report);
      await this.recorder.json(paths.journey, { id, kind: 'round', input,
        sessionIds: reports.flatMap(r => r.sessions.map(s => s.id)), status: 'running' });
    }
    const report = synthesizeReports(reports, id);
    report.comparison = initializeComparison(report);
    report.limitations = report.limitations.filter(l => !l.includes('Clustering matches category'));
    report.limitations.push('Patterns are host interpretations checked for valid evidence references, not independently verified causes. Recurrence is qualitative; shared-model bias may recur across profiles.');
    report.limitations.push('Participant interpretations and specialist reviews are deferred until all journeys finish. Context isolation is host-reported, not verified.');
    if (reports.length !== participantCount) report.limitations.push(`Round stopped after ${reports.length} of ${participantCount} planned participants.`);
    await this.recorder.finish(report);
    const status = signal?.aborted ? 'cancelled' : reports.some(r => r.sessions.some(s => s.status === 'error')) ? 'partial' : 'finished';
    await this.recorder.json(paths.journey, { id, kind: 'round', input, sessionIds: report.sessions.map(s => s.id), status });
    return { id, status, report, paths };
  }
}
