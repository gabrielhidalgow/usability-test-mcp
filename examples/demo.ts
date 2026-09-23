import { ComparisonReviews } from '../src/core/comparison.js';
import type { SessionRecord } from '../src/core/types.js';
import { resolve } from 'node:path';
import { EvidenceRecorder } from '../src/evidence/recorder.js';
import { SessionOrchestrator } from '../src/core/session-orchestrator.js';
import { RoundOrchestrator } from '../src/core/round-orchestrator.js';
import { PlaywrightProductDriver } from '../src/drivers/playwright/driver.js';
import { readConfig } from '../src/config/schema.js';
import { FixtureProvider } from '../tests/fixtures/provider.js';
import { startFixture } from '../tests/fixtures/site.js';

const config = readConfig();
const recorder = new EvidenceRecorder(resolve(config.artifactRoot));
const fixture = await startFixture();
try {
  const sessions = new SessionOrchestrator(recorder, () => new PlaywrightProductDriver(config.headless));
  const round = await new RoundOrchestrator(recorder, sessions).run({
    target: fixture.url, scenario: 'You are looking for accounting software for a small business.',
    goal: 'Find the monthly price and reach workspace setup.', personaContext: 'A small business owner comparing accounting products',
    maxActions: 12, timeoutMs: 60000,
  }, () => new FixtureProvider());
  const reviews = new ComparisonReviews(recorder);
  const participantFindings = await Promise.all(round.report.sessions.map(async session => {
    const record = JSON.parse(await recorder.read(session.id, 'journey')) as SessionRecord;
    return { sessionId: session.id, findings: await new FixtureProvider().evaluateObservation({ session: record, signal: new AbortController().signal }) };
  }));
  let review = await reviews.submit(round.id, 0, { stage: 'participants', sessions: participantFindings });
  review = await reviews.submit(round.id, review.revision, { stage: 'synthesis', patterns: [{
    title: 'Pricing is behind Options', screenOrControl: 'Home Options link', obstacle: 'Link label does not name pricing',
    findingIds: review.report.findings.map(f => f.id), recommendation: 'Name the pricing destination',
    assessments: review.report.sessions.map(s => ({ participantId: s.id, status: 'experienced', explanation: 'Fixture test double recorded label hesitation', evidence: [{ sessionId: s.id, step: 1 }] })),
  }] });
  for (const stage of ['ux', 'content'] as const) review = await reviews.submit(round.id, review.revision, { stage, notes: [] });
  console.log('DEMO ONLY: deterministic fixture test doubles; not AI usability research. Use a connected chat for real synthetic sessions.');
  console.log(JSON.stringify({ roundId: round.id, outcomes: round.report.sessions.map(s => s.status), artifacts: round.paths }, null, 2));
} finally { await fixture.close(); }
