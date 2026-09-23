import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from '../../src/mcp/server.js';
import { startFixture } from '../fixtures/site.js';
import { makeDecision } from '../fixtures/provider.js';
import type { Candidate, Interpretation } from '../../src/core/types.js';
import { setTimeout as delay } from 'node:timers/promises';

function textPayload(response: { content?: unknown }) {
  const blocks = response.content as { type: string; text?: string; data?: string }[];
  return JSON.parse(blocks.find(c => c.type === 'text')!.text!);
}

test('ordinary host tool calls drive three isolated participants, return images and synthesize reports without API credentials', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'usability-host-mcp-'));
  const server = createServer({ artifactRoot: root, headless: true });
  // No sampling capability is advertised: the portable workflow must not depend on it.
  const client = new Client({ name: 'subscription-host-test-double', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    const tools = await client.listTools();
    assert(tools.tools.some(t => t.name === 'usability_advance_session'));
    const health = textPayload(await client.callTool({ name: 'usability_health', arguments: {} }));
    assert.equal(health.apiKeyRequired, false);
    assert.equal(health.reasoningMode, 'connected-host-chat');
    const setup = textPayload(await client.callTool({ name: 'usability_setup_project', arguments: { answers: { purpose: 'Accounting' } } }));
    assert.equal(setup.questions.length, 4);
    const savedProfile = textPayload(await client.callTool({ name: 'usability_save_project', arguments: {
      name: 'Ledger', target: fixture.url,
      answers: { purpose: 'Owner-only business context', audience: 'Small business owners', priority: 'Compare plans', success: 'Find price and setup', boundaries: 'No submissions' },
      personas: [1, 2, 3].map(n => ({ name: `Visitor ${n}`, context: 'First-time visitor comparing accounting software' })),
      journeys: [{ id: 'compare', scenario: 'Comparing accounting software', goal: 'Find the monthly price and reach workspace setup.', successCriteria: ['Monthly cost is visible', 'Workspace setup is reached'] }],
    } }));
    const runArgs = { projectId: savedProfile.profile.id, journeyId: 'compare', participantCount: 3, options: { timeoutMs: 30000 } };
    assert.equal((await client.callTool({ name: 'usability_run_project', arguments: runArgs })).isError, true);
    await client.callTool({ name: 'usability_approve_project', arguments: { projectId: savedProfile.profile.id, ownerApproved: true } });
    let response = await client.callTool({ name: 'usability_run_project', arguments: runArgs });
    assert(!JSON.stringify(textPayload(response).participant).includes('Owner-only'));
    const context = textPayload(await client.callTool({ name: 'usability_get_report', arguments: { id: textPayload(response).runId, format: 'project' } }));
    assert.equal(context.profile.id, savedProfile.profile.id);
    assert.equal(context.options.timeoutMs, 30000);
    const firstPacket = textPayload(response);
    const participantIds = new Set<string>();
    let decisions = 0; let findingsSubmitted = 0; let replayTested = false;
    for (let guard = 0; guard < 20; guard++) {
      const packet = textPayload(response);
      if (packet.phase === 'finished') break;
      assert.equal(response.isError, false, JSON.stringify(packet));
      if (packet.phase === 'awaiting_decision') {
        const image = (response.content as { type: string; data?: string }[]).find(c => c.type === 'image');
        assert(image?.data); assert.equal(Buffer.from(image.data, 'base64').subarray(1, 4).toString(), 'PNG');
        assert(!JSON.stringify(packet.participant).includes(root), 'local artifact paths leaked into participant context');
        const p = packet.participant;
        if (!participantIds.has(p.sessionId)) {
          assert(p.observation.visibleText.includes('First visit'));
          assert.equal(p.history.length, 0, 'history leaked between participants');
          participantIds.add(p.sessionId);
        }
        const candidate = (p.observation.candidates as Candidate[]).find(c => c.name === 'Options' || c.name === 'Try this plan');
        const decision = p.observation.visibleText.includes('Set up your workspace')
          ? makeDecision({ type: 'finish', outcome: 'completed', reason: 'Reached setup', visibleEvidence: 'Set up your workspace; $12 per month' })
          : makeDecision({ type: 'click', target: candidate!.ref, capability: null }, 'Host test double chooses from current visible controls');
        const args = { runId: packet.runId, requestId: packet.requestId, decision };
        response = await client.callTool({ name: 'usability_advance_session', arguments: args });
        decisions++;
        if (!replayTested) {
          const replay = await client.callTool({ name: 'usability_advance_session', arguments: args });
          assert.equal(replay.isError, true);
          assert.match(textPayload(replay).error, /already-consumed/);
          const current = textPayload(await client.callTool({ name: 'usability_get_session_state', arguments: { runId: packet.runId } }));
          assert.equal(current.requestId, textPayload(response).requestId);
          replayTested = true;
        }
      } else {
        assert.equal(packet.phase, 'awaiting_findings');
        const findings: Interpretation[] = [{ title: 'Pricing label unclear', category: 'navigation', stepNumbers: [1],
          likelyUsabilityProblem: 'Options may not communicate pricing', recommendation: 'Use a clear destination label', taskImpact: 'minor-delay', confidence: 'medium' }];
        response = await client.callTool({ name: 'usability_submit_findings', arguments: { runId: packet.runId, requestId: packet.requestId, findings } });
        findingsSubmitted++;
      }
    }
    const final = textPayload(response);
    assert.equal(final.phase, 'finished', JSON.stringify(final));
    assert.equal(final.runId, firstPacket.runId);
    assert.equal(final.status, 'finished'); assert.equal(decisions, 9); assert.equal(findingsSubmitted, 3);
    assert.equal(participantIds.size, 3);
    assert.equal(final.topFindings[0].evidence.length, 3);
    assert(final.taskOutcomes.every((s: { status: string }) => s.status === 'completed'));
    const reportResource = await client.readResource({ uri: `usability://rounds/${final.runId}/report` });
    const report = JSON.parse((reportResource.contents[0] as { text: string }).text);
    assert(report.limitations.some((l: string) => l.includes('cannot guarantee model-context isolation')));
    const saved = await client.callTool({ name: 'usability_get_report', arguments: { id: final.runId, format: 'markdown' } });
    assert.match((saved.content as { text: string }[])[0]!.text, /synthetic participants/);
    assert.equal((await client.listPrompts()).prompts.length, 2);
    const prompt = await client.getPrompt({ name: 'run-usability-test', arguments: { target: fixture.url } });
    assert.match((prompt.messages[0]!.content as { text: string }).text, /Do not prescribe clicks/);
    const invalid = await client.callTool({ name: 'usability_get_report', arguments: { id: '../../.env' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await server.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('real stdio starts and cancels a browser session with no provider credentials or sampling', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'usability-stdio-host-'));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'tsx', 'src/index.ts'], cwd: process.cwd(), stderr: 'pipe',
    env: { ...process.env as Record<string, string>, OPENAI_API_KEY: '', OPENAI_MODEL: '', USABILITY_ARTIFACT_DIR: root } });
  const client = new Client({ name: 'stdio-subscription-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const health = textPayload(await client.callTool({ name: 'usability_health', arguments: {} }));
    assert.equal(health.apiKeyRequired, false);
    const started = textPayload(await client.callTool({ name: 'usability_run_session', arguments: {
      target: fixture.url, persona: { context: 'Visitor' }, scenario: 'Explore', goal: 'Find plans', accessibilityChecks: false,
    } }));
    assert.equal(started.phase, 'awaiting_decision');
    const cancelled = textPayload(await client.callTool({ name: 'usability_cancel_session', arguments: { runId: started.runId } }));
    assert.equal(cancelled.phase, 'finished'); assert.equal(cancelled.status, 'cancelled');
  } finally { await client.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});

test('invalid follow-ups preserve the request; idle timeout and host disconnect retain partial reports', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'usability-host-lifecycle-'));
  const server = createServer({ artifactRoot: root, headless: true });
  const client = new Client({ name: 'idle-host', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const input = { target: fixture.url, persona: { context: 'Visitor' }, scenario: 'Explore', goal: 'Find plans', accessibilityChecks: false };
  try {
    await server.connect(b); await client.connect(a);
    const started = textPayload(await client.callTool({ name: 'usability_run_session', arguments: { ...input, timeoutMs: 1000 } }));
    assert.equal(started.phase, 'awaiting_decision');
    const invalid = await client.callTool({ name: 'usability_advance_session', arguments: {
      runId: started.runId, requestId: started.requestId, decision: { selectedAction: { type: 'eval', source: 'do not execute' } },
    } });
    assert.equal(invalid.isError, true);
    const premature = await client.callTool({ name: 'usability_submit_findings', arguments: { runId: started.runId, requestId: started.requestId, findings: [] } });
    assert.equal(premature.isError, true);
    const pending = textPayload(await client.callTool({ name: 'usability_get_session_state', arguments: { runId: started.runId } }));
    assert.equal(pending.requestId, started.requestId);
    await delay(1300);
    const expired = textPayload(await client.callTool({ name: 'usability_get_session_state', arguments: { runId: started.runId } }));
    assert.equal(expired.phase, 'finished'); assert.equal(expired.status, 'timeout');
    assert.equal(JSON.parse(await readFile(expired.artifacts.journey, 'utf8')).status, 'timeout');
    const abandoned = textPayload(await client.callTool({ name: 'usability_run_session', arguments: input }));
    await client.close(); await server.close();
    const saved = JSON.parse(await readFile(join(root, 'sessions', abandoned.runId, 'session.json'), 'utf8'));
    assert.equal(saved.status, 'cancelled');
    assert(saved.warnings.some((w: string) => w.includes('model-context isolation')));
  } finally { await client.close(); await server.close(); await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
