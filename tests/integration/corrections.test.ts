import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../src/mcp/server.js';
import { startFixture } from '../fixtures/site.js';
import { makeDecision } from '../fixtures/provider.js';

test('context enforcement, correction lineage, restart recovery and assignment preview work through MCP', async () => {
  const fixture = await startFixture(); const root = await mkdtemp(join(tmpdir(), 'corrections-'));
  let server = createServer({ artifactRoot: root, headless: true }); let client = new Client({ name: 'correction-fixture', version: '1' });
  const connect = async () => { const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a); };
  const call = async (name: string, args: Record<string, unknown>, error = false) => {
    const result = await client.callTool({ name, arguments: args }); assert.equal(Boolean(result.isError), error, JSON.stringify(result.content));
    const text = (result.content as { type: string; text: string }[]).find(c => c.type === 'text')!.text;
    try { return JSON.parse(text); } catch { return text; }
  };
  const fresh = { mode: 'first-visit', isolation: 'host-reported fresh', exposure: [] };
  try {
    await connect();
    // Rejection happens before any browser journey, independent of discovery.
    for (const isolation of ['shared', 'unknown', 'host-reported fresh']) {
      const denied = await call('usability_quick_test', { target: fixture.url, goal: 'Read the heading', contextCheck: { mode: 'first-visit', isolation, exposure: ['source-code'] } }, true);
      assert.match(denied.error, /clean participant context/);
    }
    let prior = await call('usability_quick_test', { target: fixture.url, goal: 'Read the heading', contextCheck: { mode: 'informed-walkthrough', isolation: 'shared', exposure: ['source-code'] } });
    const priorId = prior.runId;
    prior = await call('usability_cancel_session', { runId: priorId });
    const rerun = { priorRunId: priorId, reason: 'context-contamination', changes: 'New clean participant conversation; no prior findings supplied.' };
    await call('usability_quick_test', { target: fixture.url, goal: 'Different task', contextCheck: fresh, rerun }, true);
    let state = await call('usability_quick_test', { target: fixture.url, goal: 'Read the heading', contextCheck: fresh, rerun });
    const newId = state.runId;
    assert(!JSON.stringify(state.participant).includes('context-contamination'));
    assert(!JSON.stringify(state.participant).includes(priorId));
    const decision = makeDecision({ type: 'finish', outcome: 'completed', reason: 'Heading visible', visibleEvidence: state.participant.observation.visibleText.slice(0,100) });
    decision.contextIsolation = 'shared';
    await call('usability_advance_session', { runId: newId, requestId: state.requestId, decision }, true);
    decision.contextIsolation = 'host-reported fresh';
    state = await call('usability_advance_session', { runId: newId, requestId: state.requestId, decision });
    await call('usability_submit_findings', { runId: newId, requestId: state.requestId, findings: [] });
    await client.close(); await server.close(); server = createServer({ artifactRoot: root, headless: true }); client = new Client({ name: 'restarted', version: '1' }); await connect();
    const oldReport = await call('usability_get_report', { id: priorId }); assert.equal(oldReport.supersededBy, newId);
    const archived = await call('usability_get_report', { id: priorId, format: 'markdown' }); assert.match(archived, /Superseded attempt/); assert(!archived.includes('Reported completion'));
    const replacement = await call('usability_get_report', { id: newId }); assert.equal(replacement.correction.priorRunId, priorId); assert(replacement.correction.changedFields.includes('contextCheck')); assert.equal(replacement.sessions.length, 1);
    assert.match(await call('usability_get_report', { id: newId, format: 'markdown' }), /Replaces an earlier attempt/);
    assert.match(await call('usability_get_report', { id: newId, format: 'details' }), /New clean participant conversation/);
    await call('usability_quick_test', { target: fixture.url, goal: 'Read the heading', contextCheck: fresh, rerun }, true);
    await call('usability_continue_session', { sessionId: priorId }, true);
    const saved = await call('usability_save_project', { name: 'Assigned fixture', target: fixture.url,
      answers: { purpose: 'Product', audience: 'Two roles', priority: 'Read', success: 'PRIVATE CRITERION', boundaries: 'Read only' },
      personas: [{id:'specifier',name:'Visitor',context:'Specifier'},{id:'installer',name:'Visitor',context:'Installer'}],
      journeys: [{id:'read',personaIds:['installer'],scenario:'On site',goal:'Read',successCriteria:['PRIVATE CRITERION']}] });
    await call('usability_approve_project', { projectId: saved.profile.id, ownerApproved:true });
    const options = { contextCheck: fresh, accessibilityChecks: false };
    const preview = await call('usability_preview_project_run', { projectId:saved.profile.id, journeyId:'read', options });
    assert.equal(preview.assignment.participants[0].id, 'installer'); assert(!JSON.stringify(preview).includes('PRIVATE CRITERION'));
    state = await call('usability_run_project', { projectId:saved.profile.id, journeyId:'read', options });
    assert.equal(state.participant.persona.id, 'installer'); await call('usability_cancel_session', {runId:state.runId});
  } finally { await client.close(); await server.close(); await fixture.close(); await rm(root, { recursive:true, force:true }); }
});
