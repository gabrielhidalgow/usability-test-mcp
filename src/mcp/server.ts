import { McpServer, ResourceTemplate, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { roundInputSchema, sessionInputSchema, type AppConfig } from '../config/schema.js';
import { SessionOrchestrator } from '../core/session-orchestrator.js';
import { RoundOrchestrator } from '../core/round-orchestrator.js';
import { MaestroProductDriver } from '../drivers/maestro/driver.js';
import { PlaywrightProductDriver } from '../drivers/playwright/driver.js';
import { artifactIdSchema, EvidenceRecorder } from '../evidence/recorder.js';
import { EVALUATOR_INSTRUCTIONS, PARTICIPANT_INSTRUCTIONS, participantPayload } from '../reasoning/host.js';
import { HostSessionError, HostSessions, type HostState } from '../core/host-sessions.js';
import { decisionSchema, interpretationSchema } from '../core/types.js';
import { ProjectProfiles, projectIdSchema, intakeSchema, planSchema, questions, projectRun, projectRunOptionsSchema } from '../projects/profiles.js';
import { join } from 'node:path';
import { ContinuationError, prepareContinuation } from '../core/continuation.js';
import { ComparisonReviews, ReviewError, reviewSubmissionSchema } from '../core/comparison.js';
import { redact } from '../core/safety.js';

function result(value: object, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, (_key, v: unknown) => typeof v === 'string' ? redact(v) : v, 2) }], isError };
}
export async function hostStateResult(state: HostState): Promise<CallToolResult> {
  if (state.phase === 'finished') return result({ runId: state.runId, phase: state.phase, status: state.result.status,
    taskOutcomes: state.result.report.sessions, topFindings: state.result.report.findings.slice(0, 5),
    nextTool: state.result.report.comparison ? 'usability_get_review' : undefined,
    review: state.result.report.comparison ? { id: state.runId, instructions: 'Read the current saved review status with usability_get_review; this execution response does not track later reviews.' } : undefined,
    artifacts: state.result.paths, policyDiagnostics: state.result.report.policyDiagnostics ?? [], limitations: state.result.report.limitations, synthetic: true });
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
  const server = new McpServer({ name: 'usability-test-mcp', version: '0.4.1' }, {
    instructions: 'For three perspectives on one task, set participantCount=3. Round journeys finish before interpretation; when finished follow usability_get_review and usability_submit_review through participants, synthesis, ux, content, complete. Reviews use saved evidence and survive restart. Use only the minimal participant packet in fresh host contexts where available; report contextIsolation honestly on the first decision. For a quick test with a supplied URL and goal, use usability_quick_test (device=mobile for mobile web). For native apps use usability_run_native only on an explicitly prepared test device. Continue interrupted web sessions with usability_continue_session; explain that browser state resets and this is a linked segment, not a new participant. For a reusable project, call usability_setup_project, ask the owner its missing questions, draft neutral tasks, save and show the full plan, and approve only after owner review. For an existing project, load its plan and ask what changed or which journey to retest; unchanged approved plans can be reused. Custom boundaries require host oversight; do not run a task that conflicts with them. Use the connected chat model for reasoning; no API key is needed. Start usability_run_session or usability_run_round, inspect the returned screenshot and persona, then call usability_advance_session with ONE decision and the current requestId. Continue until awaiting_findings, submit grounded findings with usability_submit_findings, and repeat until phase=finished. Use a fresh host model context per participant where supported. Never inspect target code or transfer prior findings to participants. Cancel abandoned runs.',
  });
  const recorder = new EvidenceRecorder(config.artifactRoot);
  const orchestrator = new SessionOrchestrator(recorder, input => input.platform === 'native' ? new MaestroProductDriver() : new PlaywrightProductDriver(config.headless));
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
        : 'Ask these questions in chat. Then propose 1–3 realistic journeys and three task-relevant personas with different prior knowledge, technical confidence and information needs. Ask which profile details are supported by owner research; mark unsupported profiles as assumption. Do not invent demographic or disability behaviours. Preserve existing approved profiles. Tasks describe user intent, not clicks, routes, selectors, or answers. Success criteria must be observable. Save a draft with usability_save_project and show the full returned plan for owner review. Do not collect credentials.',
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
    inputSchema: z.strictObject({ projectId: projectIdSchema, journeyId: z.string(), participantCount: z.number().int().min(1).max(5).default(1), options: projectRunOptionsSchema.default({}) }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async ({ projectId, journeyId, participantCount, options }, ctx) => {
    try {
      const profile = await projects.get(projectId);
      const run = projectRun(profile, journeyId, participantCount, options);
      const state = await host.start(run.kind, run.input, ctx.mcpReq.signal);
      await recorder.json(join(recorder.paths(state.runId).directory, 'project.json'), { profile, journeyId, participantCount, options });
      return await hostStateResult(state);
    } catch { return result({ error: 'Could not start project run. Check approval, journey ID and saved persona count.' }, true); }
  });
  server.registerTool('usability_continue_session', {
    description: 'Continue an interrupted WEB session in a linked segment, including after server restart. Restores only the last observed URL and this participant’s history; browser state is reset. Never replays actions. Cannot continue an active/completed session. Explain these limits before use.',
    inputSchema: z.strictObject({ sessionId: artifactIdSchema, timeoutMs: z.number().int().min(1000).max(600000).default(600000), accessibilityChecks: z.boolean().optional() }),
  }, async ({ sessionId, timeoutMs, accessibilityChecks }, ctx) => {
    if (host.isActive(sessionId)) return result({ error: 'This session is still active. Use usability_get_session_state, or cancel it before continuing.' }, true);
    try {
      const prepared = await prepareContinuation(recorder, sessionId, { timeoutMs, accessibilityChecks });
      let project;
      try { project = JSON.parse(await readFile(join(recorder.paths(sessionId).directory, 'project.json'), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ContinuationError('Saved project context is unreadable. Inspect the prior artifacts before continuing.'); }
      const state = await host.start('session', prepared.input, ctx.mcpReq.signal, prepared.context);
      try {
        if (project) await recorder.json(join(recorder.paths(state.runId).directory, 'project.json'), { ...project, continuationOf: sessionId, continuationOptions: { timeoutMs, accessibilityChecks: prepared.input.accessibilityChecks } });
      } catch { await host.cancel(state.runId); throw new ContinuationError('Could not save continuation project context; the new segment was cancelled.'); }
      return await hostStateResult(state);
    } catch (error) { return result({ error: error instanceof ContinuationError ? error.message : 'Saved session is unavailable or invalid. Inspect its artifacts or start a fresh test.' }, true); }
  });
  server.registerTool('usability_quick_test', {
    description: 'Start a short desktop or mobile WEB test from a URL and user goal, without saving a project. Set participantCount=3 for comparison and post-run reviews. Defaults to one first-time visitor, 12 actions, 10 minutes and no axe scan. Follow nextTool until finished. Ask for a goal if missing; never infer a route from source code.',
    inputSchema: z.strictObject({ target: z.url().refine(value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } }), goal: z.string().min(1).max(2000), audience: z.string().min(1).max(2000).default('A first-time visitor'), device: z.enum(['desktop', 'mobile']).default('desktop'), participantCount: z.number().int().min(1).max(5).default(1), accessibilityChecks: z.boolean().default(false) }),
  }, async ({ target, goal, audience, device, participantCount, accessibilityChecks }, ctx) => respond(() => host.start(participantCount === 1 ? 'session' : 'round', { target, goal, scenario: 'You are using this product for the first time to pursue the supplied goal.', ...(participantCount === 1 ? { persona: { context: audience } } : { participantCount, personaContext: audience }), viewport: device, maxActions: 12, timeoutMs: 600000, accessibilityChecks }, ctx.mcpReq.signal)));
  server.registerTool('usability_run_native', {
    description: 'EXPERIMENTAL native iOS/Android screenshot-driven test via local Maestro. Requires Maestro/Java, a booted prepared test emulator/simulator and installed app. No network interception, data reset, credential masking or native accessibility audit. Only sandbox apps with fake data. Follow nextTool until finished; use tap_point/enter_text from screenshots. No API keys.',
    inputSchema: z.strictObject({ appId: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/), deviceId: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/), os: z.enum(['ios','android']), preparedTestDevice: z.literal(true), goal: z.string().min(1).max(2000), audience: z.string().min(1).max(2000).default('A first-time app user') }),
  }, async ({ appId, deviceId, os, preparedTestDevice, goal, audience }, ctx) => respond(() => host.start('session', { platform: 'native', target: appId, native: { deviceId, os, preparedTestDevice }, testEnvironment: true, allowedCapabilities: [], goal, persona: { context: audience }, scenario: 'Use the app for the first time to pursue the supplied goal.', maxActions: 12, timeoutMs: 600000, accessibilityChecks: false }, ctx.mcpReq.signal)));
  server.registerTool('usability_health', { description: 'Check local server status. Reasoning is supplied by the connected chat; no model API credentials.', inputSchema: z.strictObject({}) },
    async () => result({ status: 'ok', platforms: ['web', 'mobile-web', 'native-experimental'], reasoningMode: 'connected-host-chat', apiKeyRequired: false, artifactRoot: config.artifactRoot }));
  server.registerTool('usability_run_session', {
    description: 'Start a synthetic participant and return its current UI plus screenshot. The connected chat chooses each action through usability_advance_session; continue until phase=finished. No AI API required.',
    inputSchema: sessionInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (input, ctx) => respond(() => host.start('session', input, ctx.mcpReq.signal)));
  server.registerTool('usability_run_round', {
    description: 'Start a three-participant round by default. The host supplies decisions; interpretation is deferred until all journeys finish. Then follow usability_get_review through all review stages. Each participant gets a fresh browser; the host manages model-context isolation. timeoutMs includes host thinking time per participant.',
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
  const reviews = new ComparisonReviews(recorder);
  const reviewResponse = async (operation: () => Promise<CallToolResult>) => {
    try { return await operation(); }
    catch (error) { return result({ error: error instanceof ReviewError ? error.message : 'Review unavailable or invalid. Check the saved comparison, revision, and evidence references.' }, true); }
  };
  server.registerTool('usability_get_review', {
    description: 'Read the next saved post-run review stage. Optionally supply sessionId and step to inspect its recorded screenshots. Complete participants, synthesis, UX and content reviews after journeys finish. No browser actions.',
    inputSchema: z.strictObject({ id: artifactIdSchema, sessionId: artifactIdSchema.optional(), step: z.number().int().positive().optional() }).refine(x => Boolean(x.sessionId) === Boolean(x.step), 'Provide sessionId and step together'),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id, sessionId, step }) => reviewResponse(async () => {
    if (host.isActive(id)) throw new ReviewError('Finish all participant journeys before review.');
    if (!sessionId || !step) return result(await reviews.get(id));
    const observation = await reviews.observation(id, sessionId, step);
    const response = result({ sessionId, step, observation });
    for (const screenshot of [observation.before.screenshot, ...(observation.after ? [observation.after.screenshot] : [])]) {
      response.content.push({ type: 'image', mimeType: 'image/png', data: (await readFile(screenshot.path)).toString('base64') });
    }
    return response;
  }));
  server.registerTool('usability_submit_review', {
    description: 'Save a validated post-run review stage using its current revision. Exact retries are idempotent; stale changes are rejected. Invalid submissions leave the base report intact. Expert reviews never increase participant recurrence.',
    inputSchema: z.strictObject({ id: artifactIdSchema, revision: z.number().int().nonnegative(), submission: reviewSubmissionSchema }),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ id, revision, submission }) => reviewResponse(async () => {
    if (host.isActive(id)) throw new ReviewError('Finish all participant journeys before review.');
    return result(await reviews.submit(id, revision, submission));
  }));
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
    text: `Run synthetic usability testing on ${target}. ${goal ? `Goal: ${goal}.` : 'Confirm a realistic user scenario and goal from the visible product.'} You, the connected chat, supply reasoning using your existing subscription; no model API is needed. Start usability_setup_project and ask its missing questions. Save and show the full proposed plan; approve it only after owner acceptance. Run the chosen journey using usability_run_project with one participant first. Reuse approved plans for subsequent runs and increase to three participants when ready. Follow each nextTool: inspect the image, submit one decision using usability_advance_session, and submit interpretations only at awaiting_findings. Continue until phase=finished. For rounds, complete usability_get_review/usability_submit_review through participants, synthesis, ux, content and complete; inspect recorded screenshots as needed. Then read usability_get_report with format=project and compare each success criterion with journey evidence, reporting observed, not observed, or inconclusive. Do not prescribe clicks or paths to participants. Use a fresh model context per participant if your host supports it; otherwise disclose shared model context. Never use source-code knowledge or prior participant findings during a participant journey. Keep observation and interpretation separate. Do not modify target code or enable consequential capabilities without explicit authorization.` } }] }));
  server.registerPrompt('retest-after-fixes', {
    description: 'Rerun a saved scenario and compare evidence qualitatively.',
    argsSchema: z.object({ priorId: z.string() }),
  }, ({ priorId }) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const,
    text: `Read the journey and report for ${priorId} using usability_get_report. Rerun the original target, scenario, goal and personas with new isolated sessions. Do not provide old findings or paths to participants. Compare old and new evidence afterward: distinguish recurring findings, findings not observed again, and new findings. Absence alone does not prove resolution. Clearly label the qualitative comparison and do not claim statistical significance or edit target code.` } }] }));
  return server;
}
