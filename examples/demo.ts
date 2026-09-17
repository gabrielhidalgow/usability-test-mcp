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
  console.log('DEMO ONLY: deterministic fixture test doubles; not AI usability research. Use a connected chat for real synthetic sessions.');
  console.log(JSON.stringify({ roundId: round.id, outcomes: round.report.sessions.map(s => s.status), artifacts: round.paths }, null, 2));
} finally { await fixture.close(); }
