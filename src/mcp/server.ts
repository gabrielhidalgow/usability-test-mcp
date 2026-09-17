import { McpServer, ResourceTemplate, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { roundInputSchema, sessionInputSchema, type AppConfig } from '../config/schema.js';
import { SessionOrchestrator } from '../core/session-orchestrator.js';
import { RoundOrchestrator } from '../core/round-orchestrator.js';
import { PlaywrightProductDriver } from '../drivers/playwright/driver.js';
import { artifactIdSchema, EvidenceRecorder } from '../evidence/recorder.js';
import { EVALUATOR_INSTRUCTIONS, PARTICIPANT_INSTRUCTIONS, participantPayload } from '../reasoning/host.js';
import { HostSessionError, HostSessions, type HostState } from '../core/host-sessions.js';
import { decisionSchema, interpretationSchema } from '../core/types.js';
import { ProjectProfiles, projectIdSchema, intakeSchema, planSchema, questions, projectRun } from '../projects/profiles.js';
import { join } from 'node:path';
import { redact } from '../core/safety.js';

function result(value: object, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, (_key, v: unknown) => typeof v === 'string' ? redact(v) : v, 2) }], isError };
}
export async function hostStateResult(state: HostState): Promise<CallToolResult> {
  if (state.phase === 'finished') return result({ runId: state.runId, phase: state.phase, status: state.result.status,
    taskOutcomes: state.result.report.sessions, topFindings: state.result.report.findings.slice(0, 5),
    artifacts: state.result.paths, synthetic: true });
  if (state.phase === 'error') return result(state, true);
  if (state.phase === 'running') return result({ ...state, nextTool: 'usability_get_session_state' });
  const pending = state.pending;
  if (pending.phase === 'awaiting_decision') {
    const response = result({ runId: state.runId, phase: pending.phase, requestId: pending.requestId,
      nextTool: 'usability_advance_session', instructions: PARTICIPANT_INSTRUCTIONS,
      participant: participantPayload(pending.input) });
    response.content.push({ type: 'image', mimeType: 'image/png', data: (await readFile(pending.input.observation.screenshot.path)).toString('base64') });
    return response;
  }
  return result({ runId: state.runId, phase: pending.phase, requestId: pending.requestId,
    nextTool: 'usability_submit_findings', instructions: EVALUATOR_INSTRUCTIONS,
    session: pending.session });
}
export function createServer(config: AppConfig) {
  const server = new McpServer({ name: 'usability-mcp', version: '0.2.0' }, {
    instructions: 'For a new project, call usability_setup_project, ask the owner its missing questions, draft neutral tasks, save and show the full plan, and approve only after owner review. For an existing project, load its plan and ask what changed or which journey to retest; unchanged approved plans can be reused. Custom boundaries require host oversight; do not run a task that conflicts with them. Use the connected chat model for reasoning; no API key is needed. Start usability_run_session or usability_run_round, inspect the returned screenshot and persona, then call usability_advance_session with ONE decision and the current requestId. Continue until awaiting_findings, submit grounded findings with usability_submit_findings, and repeat until phase=finished. Use a fresh host model context per participant where supported. Never inspect target code or transfer prior findings to participants. Cancel abandoned runs.',
  });
  const recorder = new EvidenceRecorder(config.artifactRoot);
  const orchestrator = new SessionOrchestrator(recorder, () => new PlaywrightProductDriver(config.headless));
  const rounds = new RoundOrchestrator(recorder, orchestrator);
  const host = new HostSessions(orchestrator, rounds);
  const closeServer = server.close.bind(server);
  server.close = async () => { await host.close(); await closeServer(); };
  server.server.onclose = () => { void host.close(); };
  const respond = async (operation: () => Promise<HostState>): Promise<CallToolResult> => {
    try { return await hostStateResult(await operation()); }
    catch (error) { return result({ error: error instanceof HostSessionError ? error.message : 'Request could not complete. Inspect the current run with usability_get_session_state or start a new run.' }, true); }
  };
  const projects = new ProjectProfiles(config.artifactRoot);
  const projectResponse = async (operation: () => Promise<object>) => {
    try { return result(await operation()); }
    catch { return result({ error: 'Project request failed. Check the project ID and plan fields; runs require an approved plan, a valid journey ID, and enough saved personas.' }, true); }
  };
  server.registerTool('usability_setup_project', {
    description: 'Begin a guided project questionnaire or reuse a saved profile. Ask only unanswered questions. Never infer owner priorities from target code.',
    inputSchema: z.strictObject({ projectId: projectIdSchema.optional(), answers: intakeSchema.partial().default({}) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ projectId, answers }) => projectResponse(async () => {
    const profile = projectId ? await projects.get(projectId) : undefined;
    const combined = { ...profile?.plan.answers, ...answers };
    return { profile, answers: combined,
      questions: Object.entries(questions).filter(([key]) => !combined[key as keyof typeof questions]).map(([field, question]) => ({ field, question })),
      instructions: profile
        ? 'Ask what changed and which journey to test. Reuse unchanged approved plans. For changes, save a new complete draft and review it with the owner.'
        : 'Ask these questions in chat. Then propose 1–3 realistic journeys and relevant personas. Tasks describe user intent, not clicks, routes, selectors, or answers. Success criteria must be observable. Save a draft with usability_save_project and show the full returned plan for owner review. Do not collect credentials.',
      boundaries: 'Profile runs deny consequential actions. Custom written boundaries are host-enforced, not a browser policy engine; omit conflicting tasks. Authentication setup is not automated.',
    };
  }));
  server.registerTool('usability_save_project', {
    description: 'Save a complete draft test plan. Show it to the owner before approval. Every edit creates a new immutable draft ID; previous approval does not carry over.',
    inputSchema: planSchema,
  }, async plan => projectResponse(async () => ({ profile: await projects.save(plan), nextTool: 'usability_approve_project', instructions: 'Show the full plan, including personas, tasks, success criteria and boundaries. Call approve only after the owner accepts this plan.' })));
  server.registerTool('usability_approve_project', {
    description: 'Mark this exact immutable plan approved only after the owner has reviewed and accepted it in chat. This records host-attested approval; it cannot verify the conversation.',
    inputSchema: z.strictObject({ projectId: projectIdSchema, ownerApproved: z.literal(true) }),
  }, async ({ projectId }) => projectResponse(async () => ({ profile: await projects.approve(projectId) })));
  server.registerTool('usability_list_projects', {
    description: 'List saved local project profiles, including drafts.', inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => projectResponse(async () => ({ projects: await projects.list() })));
  server.registerTool('usability_run_project', {
    description: 'Run an approved project journey with one participant by default; request three when ready. Check saved boundaries first. Follow returned nextTool until finished. Success criteria and owner context are saved separately for post-run evaluation; do not give them to participants.',
    inputSchema: z.strictObject({ projectId: projectIdSchema, journeyId: z.string(), participantCount: z.number().int().min(1).max(5).default(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async ({ projectId, journeyId, participantCount }, ctx) => {
    try {
      const profile = await projects.get(projectId);
      const run = projectRun(profile, journeyId, participantCount);
      const state = await host.start(run.kind, run.input, ctx.mcpReq.signal);
      await recorder.json(join(recorder.paths(state.runId).directory, 'project.json'), { profile, journeyId, participantCount });
      return await hostStateResult(state);
    } catch { return result({ error: 'Could not start project run. Check approval, journey ID and saved persona count.' }, true); }
  });
  server.registerTool('usability_health', { description: 'Check local server status. Reasoning is supplied by the connected chat; no model API credentials.', inputSchema: z.strictObject({}) },
    async () => result({ status: 'ok', platform: 'web', reasoningMode: 'connected-host-chat', apiKeyRequired: false, artifactRoot: config.artifactRoot }));
  server.registerTool('usability_run_session', {
    description: 'Start a synthetic participant and return its current UI plus screenshot. The connected chat chooses each action through usability_advance_session; continue until phase=finished. No AI API required.',
    inputSchema: sessionInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (input, ctx) => respond(() => host.start('session', input, ctx.mcpReq.signal)));
  server.registerTool('usability_run_round', {
    description: 'Start a three-participant round by default. The host supplies decisions and findings through follow-up tools. Each participant gets a fresh browser; the host manages model-context isolation. timeoutMs includes host thinking time per participant.',
    inputSchema: roundInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (input, ctx) => respond(() => host.start('round', input, ctx.mcpReq.signal)));
  server.registerTool('usability_run_accessibility', {
    description: 'Start a host-driven keyboard-only journey with axe scans. Continue with usability_advance_session. This is not a full WCAG or screen-reader audit.',
    inputSchema: sessionInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (input, ctx) => respond(() => host.start('session', { ...input, accessibilityChecks: true, interactionMode: 'keyboard' }, ctx.mcpReq.signal)));
  server.registerTool('usability_advance_session', {
    description: 'Supply ONE decision based on the returned screenshot/current visible state. Reuse runId and the latest requestId, never a previous one. Returns the next observation or a findings request.',
    inputSchema: z.strictObject({ runId: artifactIdSchema, requestId: z.uuid(), decision: decisionSchema }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ runId, requestId, decision }, ctx) => respond(() => host.advance(runId, requestId, decision, ctx.mcpReq.signal)));
  server.registerTool('usability_submit_findings', {
    description: 'After awaiting_findings, supply up to 8 evidence-grounded interpretations (or []); save the report and start the next participant if part of a round.',
    inputSchema: z.strictObject({ runId: artifactIdSchema, requestId: z.uuid(), findings: z.array(interpretationSchema).max(8) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ runId, requestId, findings }, ctx) => respond(() => host.findings(runId, requestId, findings, ctx.mcpReq.signal)));
  server.registerTool('usability_get_session_state', {
    description: 'Read the current request or final state without repeating an action. Use after an interrupted tool response. Live runs are in-memory; completed reports survive restart.',
    inputSchema: z.strictObject({ runId: artifactIdSchema }), annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ runId }) => respond(async () => host.getState(runId)));
  server.registerTool('usability_cancel_session', {
    description: 'Cancel an active session or round, close its browser, and save partial evidence.',
    inputSchema: z.strictObject({ runId: artifactIdSchema }), annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ runId }) => respond(() => host.cancel(runId)));
  server.registerTool('usability_get_report', {
    description: 'Read a saved session or round report by its artifact ID. For profile runs, format=project returns the exact owner-approved setup and success criteria. After the run, compare each criterion with recorded evidence and report observed, not observed, or inconclusive; never infer success without evidence.',
    inputSchema: z.strictObject({ id: artifactIdSchema, format: z.enum(['json', 'markdown', 'journey', 'project']).default('json') }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, format }) => {
    try { return { content: [{ type: 'text' as const, text: format === 'project' ? await readFile(join(recorder.paths(id).directory, 'project.json'), 'utf8') : await recorder.read(id, format) }] }; }
    catch { return result({ error: 'Artifact not found or unreadable.' }, true); }
  });
  for (const kind of ['sessions', 'rounds']) {
    for (const artifact of ['report', 'journey', 'accessibility'] as const) {
      server.registerResource(`${kind}-${artifact}`, new ResourceTemplate(`usability://${kind}/{id}/${artifact}`, { list: undefined }),
        { description: `Synthetic usability ${artifact} JSON`, mimeType: 'application/json' }, async (uri, variables) => {
          const parsed = artifactIdSchema.safeParse(variables.id);
          if (!parsed.success || !parsed.data.startsWith(kind === 'sessions' ? 'session-' : 'round-')) throw new Error('Invalid artifact ID');
          try {
            let content = await recorder.read(parsed.data, artifact === 'journey' ? 'journey' : 'json');
            if (artifact === 'accessibility') {
              const parsedReport = z.object({ accessibility: z.array(z.unknown()) }).parse(JSON.parse(content));
              content = JSON.stringify(parsedReport.accessibility, null, 2);
            }
            return { contents: [{ uri: uri.href, mimeType: 'application/json', text: content }] };
          } catch { throw new Error('Artifact not found or unreadable'); }
        });
    }
  }
  server.registerPrompt('run-usability-test', {
    description: 'Prepare a realistic synthetic usability round without prescribing a route.',
    argsSchema: z.object({ target: z.string(), goal: z.string().optional() }),
  }, ({ target, goal }) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const,
    text: `Run synthetic usability testing on ${target}. ${goal ? `Goal: ${goal}.` : 'Confirm a realistic user scenario and goal from the visible product.'} You, the connected chat, supply reasoning using your existing subscription; no model API is needed. Start usability_setup_project and ask its missing questions. Save and show the full proposed plan; approve it only after owner acceptance. Run the chosen journey using usability_run_project with one participant first. Reuse approved plans for subsequent runs and increase to three participants when ready. Follow each nextTool: inspect the image, submit one decision using usability_advance_session, and submit interpretations only at awaiting_findings. Continue until phase=finished. Then read usability_get_report with format=project and compare each success criterion with journey evidence, reporting observed, not observed, or inconclusive. Do not prescribe clicks or paths to participants. Use a fresh model context per participant if your host supports it; otherwise disclose shared model context. Never use source-code knowledge or prior participant findings during a participant journey. Keep observation and interpretation separate. Do not modify target code or enable consequential capabilities without explicit authorization.` } }] }));
  server.registerPrompt('retest-after-fixes', {
    description: 'Rerun a saved scenario and compare evidence qualitatively.',
    argsSchema: z.object({ priorId: z.string() }),
  }, ({ priorId }) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const,
    text: `Read the journey and report for ${priorId} using usability_get_report. Rerun the original target, scenario, goal and personas with new isolated sessions. Do not provide old findings or paths to participants. Compare old and new evidence afterward: distinguish recurring findings, findings not observed again, and new findings. Absence alone does not prove resolution. Clearly label the qualitative comparison and do not claim statistical significance or edit target code.` } }] }));
  return server;
}
