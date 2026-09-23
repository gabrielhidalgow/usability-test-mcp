# Usability MCP

A local-first MCP server for **synthetic usability testing** of websites and mobile web. Participants choose one action at a time from the current screenshot and visible UI semantics. The server stores journeys, screenshots, axe results, and evidence-linked JSON/Markdown reports.

**Use your existing chat subscription in an MCP-capable host. No AI API key, direct provider API call, or separate API billing is required.** The connected chat supplies decisions; this local server controls the browser and records the evidence. Your host's normal plan limits and tool permissions still apply.

Synthetic participants are not real people. Their commentary and completion judgments must not be represented as real-user research. There is no overall usability score, and automated accessibility checks are not a WCAG conformance audit.

## One-command setup from GitHub

Requires **Node.js 22+**, npm, Git, and an installed MCP-capable host. For Codex registration, the `codex` CLI must be on PATH. Private-repository installs also require Git authentication with access to the repository.

```bash
npx --yes github:gabrielhidalgow/usability-mcp setup --host codex
```

For Claude Desktop on macOS:

```bash
npx --yes github:gabrielhidalgow/usability-mcp setup --host claude
```

The installer builds the GitHub source, installs a durable runtime and Chromium, checks that Chromium launches, then registers the server. Restart the host and enable its tools. Ask it to call `usability_health`, then say **“Set up a usability test for [URL].”** Host permissions and a restart can still require interaction; setup does not sign you into a chat subscription.

The default installation is `~/.local/share/usability-mcp/`, with saved profiles and reports under `artifacts/`. Use `--dir "/absolute/path"` to change it. Re-running setup updates the runtime and preserves artifacts. Stop active tests before updating. The configured Node executable must remain installed at its original path; rerun setup after moving Node.

Automatic registration supports Codex on macOS/Linux and Claude Desktop on macOS. `--host manual` installs and prints configuration for other compatible local hosts on macOS/Linux. On Linux, missing browser system libraries may need administrator installation separately; the browser check will report failure. Windows automatic installation is not included. This installs a local stdio MCP server, not a remote ChatGPT connector.

Claude configuration is merged and backed up alongside its existing file; other entries are preserved. The named `usability` entry is replaced on update. Codex registration uses its official `codex mcp add` command. Test reports and profiles are not included in the distributable package.

For a reproducible release, replace `github:gabrielhidalgow/usability-mcp` with `github:gabrielhidalgow/usability-mcp#COMMIT_OR_TAG`. The repository must be accessible to the person installing; public sharing and npm registry publication are separate steps. No npm registry release is required for GitHub installation.

To uninstall, remove the `usability` entry from your host (Codex: `codex mcp remove usability`) and delete the installation's `runtime/` folder. Keep `artifacts/` if you want to retain your reports and profiles. Chromium's shared Playwright cache is left intact.

For local development, build first and run `node bin/usability-mcp.mjs setup --host manual`. The commands below are for contributors rather than end users.

## Install and verify

Requires Node.js 22 or newer, npm, and Chromium. This repository uses the stable MCP TypeScript SDK v2.

```bash
npm ci
npx playwright install chromium
npm run check
npm run demo
```

On Linux, use `npx playwright install --with-deps chromium` if browser system libraries are missing.

`npm run demo` starts a disposable fixture, runs three fresh browser sessions, and prints the report paths. **It uses deterministic fixture test doubles, not an AI model.** It demonstrates the transport-independent execution, isolation, evidence, axe, and reporting pipeline without making paid API calls. The fixture includes an intentionally ambiguous navigation label and a missing image description.

## How the connected chat runs a test

```bash
npm run fixture
```

Connect the MCP server to your chat host using the settings below. Ask the chat to test the fixture or your own local/staging site. The chat follows an ordinary tool loop:

```text
usability_run_session (or usability_run_round)
  -> screenshot + visible state + persona/scenario/goal
  -> chat chooses one action
usability_advance_session
  -> next screenshot + visible state
  -> repeat until participant finishes
usability_submit_findings
  -> report, or next participant in a round
```

The server returns `nextTool` and a one-use `requestId` at each pause. The chat should continue until `phase: "finished"`; starting a run is not completing it. Ordinary MCP tools and image results are used; **MCP sampling support is not required**. The server does not log in to a provider, reuse subscription tokens, scrape chat websites, or call a model endpoint.

The host normally starts the stdio server itself. `npm start` waits for MCP messages; it is not a web server. `.env` is optional and contains only local settings, such as `USABILITY_ARTIFACT_DIR` and `USABILITY_HEADLESS`; nothing needs to be configured for model credentials.

Screenshots and UI text are returned to your connected chat and handled under that host's data policies. Only test data you are authorized to share there. The server does not send target source code or response bodies to the host. Browser data is isolated per participant; **chat context is controlled by the host**, so use fresh model contexts where available and avoid running participants in a conversation that already knows the target implementation. If one chat runs all personas, treat them as separate browser journeys, not independently isolated model participants.

## Connect to Codex

Run `npm run build`. Add the following entry to your project-scoped `.codex/config.toml` (trusted project) or merge it into `~/.codex/config.toml`. Replace `/ABSOLUTE/PATH/usability-mcp` in every location with this repository's absolute path; paths containing spaces work inside the quoted strings.

```toml
[mcp_servers.usability]
command = "node"
args = ["/ABSOLUTE/PATH/usability-mcp/dist/src/index.js"]
cwd = "/ABSOLUTE/PATH/usability-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

If the desktop app cannot find Node, replace `node` with the output of `command -v node`. Restart the MCP connection/app and check `/mcp`, then ask Codex to call `usability_health`. It should return `reasoningMode: "connected-host-chat"` and `apiKeyRequired: false`. Each tool call only waits for browser work; chat thinking happens between calls.

Alternatively register through the CLI, then set `cwd` and `tool_timeout_sec` in the resulting entry:

```bash
codex mcp add usability -- node /ABSOLUTE/PATH/usability-mcp/dist/src/index.js
codex mcp list
```

Quote arguments containing spaces when using the CLI. These setup instructions follow the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/). This build does not modify your existing Codex configuration automatically.

## Connect to Claude Desktop or another local MCP host

For Claude Desktop's developer configuration, merge this into its existing `claude_desktop_config.json` (do not replace other servers):

```json
{
  "mcpServers": {
    "usability": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/usability-mcp/dist/src/index.js"],
      "env": { "USABILITY_ARTIFACT_DIR": "/ABSOLUTE/PATH/usability-mcp/.usability" }
    }
  }
}
```

Use absolute paths, restart the host, and enable the tools in your conversation. See the [official local MCP setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers). Other MCP hosts need the same executable/arguments and must support image tool results and multi-step tool use. Packaging as a desktop extension is not included yet.

**Local host support matters:** this release uses stdio on your computer. ChatGPT in a browser does not directly read a local Codex MCP configuration; hosted chat access may require a remote connector. This build does not provide an HTTP deployment or tunnel. Using a subscription does not by itself guarantee a particular app can launch a local MCP server. End-to-end protocol behavior is tested; product-specific UI connection setup must be completed in your chosen host.

With the fixture running, try:

> Run a usability test on http://127.0.0.1:4173. Use three first-time small business owners comparing accounting software. Their goal is to find the monthly price and reach workspace setup. Include accessibility checks. Do not modify the code. Give me the most important synthetic usability findings with screenshot evidence.

For a keyboard journey, ask for `usability_run_accessibility` with the same persona, scenario, and goal. For your own application, replace the target and supply a realistic goal, without prescribing a path.

## MCP interface

| Tool | Behavior |
| --- | --- |
| `usability_health` | Local status and API-free host reasoning mode |
| `usability_run_session` | Start one participant; returns screenshot and first decision request |
| `usability_run_round` | Start three participants by default; fresh browser contexts and combined report |
| `usability_run_accessibility` | Start a keyboard-only journey with axe scans |
| `usability_advance_session` | Validate and execute one host decision, then return the next request |
| `usability_submit_findings` | Save grounded interpretations after a participant finishes |
| `usability_get_session_state` | Recover the current request after a lost response without replaying an action |
| `usability_cancel_session` | Close an abandoned run and retain partial evidence |
| `usability_get_report` | Read JSON, Markdown, or journey by session/round ID |

`examples/session.json` is a complete session input. The authoritative Zod schema is `src/config/schema.ts`; MCP `tools/list` publishes its JSON Schema. Unknown fields are rejected.

Required session fields: `target`, `persona.context`, `scenario`, `goal`. Defaults: web, desktop, 30 actions, 180 seconds, accessibility checks enabled, standard interaction mode, no consequential capabilities. `platform: "mobile"` is intentionally rejected; `viewport: "mobile"` means mobile web.

Round inputs replace `persona` with optional `personas`, `participantCount` (default 3, maximum 5), and `personaContext`. If you supply personas, their count must equal `participantCount`. Generated personas vary task-relevant technical confidence and constraints; they are templates, not demographic representation. The server resets browser storage and the supplied history per participant, but cannot reset the host's chat memory. Sessions run sequentially; `timeoutMs` includes time waiting for the chat's decisions and findings. Use up to 600000 ms for longer chat journeys.

Follow-up tools require the returned `runId` and `requestId`. A consumed request cannot execute twice. At `awaiting_decision`, submit a `decision` matching the published tool schema (state summary, simulated commentary, selected action, confidence, nullable expectation/friction, behavior). At `awaiting_findings`, submit up to eight evidence-linked `findings`, or `[]`. The next response is either another participant's observation or the completed report. Do not call the start tool repeatedly to advance an existing run.

Abandoned runs time out and save partial reports. Live runs are held in memory and cannot resume after a server restart; saved artifacts remain readable. At most four runs are active at once; the last 24 active/completed run states are cached. On connection shutdown the server cancels pending work and closes browsers. Use `usability_cancel_session` before leaving a test unfinished.

Session status is `completed`, `incomplete`, `blocked`, `timeout`, `cancelled`, or `error`. Completion is the model's evidence-grounded judgment. Round status describes execution (`finished`, `partial`, `cancelled`); inspect individual outcomes rather than treating `finished` as task success.

Resource templates:

```text
usability://sessions/<session-id>/report
usability://sessions/<session-id>/journey
usability://sessions/<session-id>/accessibility
usability://rounds/<round-id>/report
usability://rounds/<round-id>/journey
usability://rounds/<round-id>/accessibility
```

Prompts: `run-usability-test` and `retest-after-fixes`. The retest prompt tells the host to reuse the saved inputs without giving prior findings to participants and compare evidence afterward. Automatic comparison classification is not implemented yet.

## Evidence and interpretation

```text
.usability/
  sessions/session-<uuid>/
    session.json
    report.json
    report.md
    screenshots/0001.png
    accessibility/0000.json
  rounds/round-<uuid>/
    round.json
    report.json
    report.md
```

The directory is ignored by Git. Set `USABILITY_ARTIFACT_DIR` to change its root (absolute paths are best for host-launched servers). Journey snapshots are checkpointed before and after actions; timeouts and failures still generate reports. A screenshot is reused as the next action's before-state so evidence stays continuous. Each state gets an axe scan when enabled.

Reports keep executed actions, action results, simulated commentary, interpretations, recommendations, and evidence references separate. Findings with nonexistent steps or harness safety blocks are discarded. Severity follows task impact. Round clustering conservatively matches category and normalized title and ranks by severity then recurrence; paraphrased findings can remain separate. No statistical significance is claimed.

## Safety and limitations

- Use local/disposable fixtures or a staging environment you are authorized to test. Browser interaction can change application state even though the server never edits target source files.
- Consequential labels, off-origin navigation, non-HTTP navigation, downloads, popups, WebSockets, and unapproved non-read HTTP requests are guarded. Service workers are blocked. This can prevent legitimate apps from loading or completing a task.
- Overrides require **both** `testEnvironment: true` and explicit `allowedCapabilities`: `formSubmission`, `accountCreation`, `communication`, `publicPosting`, `deletion`, `accountClosure`, `payment`. Enable only for fake data and sandbox services. Never enable payment against real money or communication against real recipients.
- These guards are defense in depth, **not a security sandbox**. Labels and HTTP methods cannot prove a site's side effects; even GET requests can change state. A dishonest model or misleading interface can misclassify actions. Do not point this at real payment, messaging, or destructive production flows.
- Password and common payment inputs are excluded/masked. Common secret patterns are redacted from text artifacts, and raw provider errors are not persisted. Screenshots and other UI text can still contain sensitive data; inspect artifacts before sharing. Query strings are stripped from stored locations, so exact replay of tokenized/deep-link URLs may require the original target.
- Controls must be visible in the main frame and exposed as normal DOM/semantic elements. Cross-origin frames, canvas-only controls, native dialogs, select-option choice, file upload, authentication, multi-tab journeys, and full screen-reader behavior are outside this MVP. `tap` currently uses browser click semantics.
- Keyboard mode records focus and key actions; it does not automatically certify focus visibility, focus order, traps, live announcements, zoom, or reduced-motion behavior.
- The participant has a bounded recent history, no filesystem/browser-code tools, and no discovery memory. Product content is treated as untrusted evidence. Every fresh observation invalidates old target references.

## Architecture and delivery status

`SessionOrchestrator` depends on `ProductDriver` and `ReasoningProvider`. `HostReasoningProvider` pauses the loop for a host decision or interpretation; `HostSessions` connects those pauses to ordinary MCP calls. Playwright handles browser lifecycle, visible UI extraction, targeting, and axe. There is no provider SDK or direct model endpoint. Evidence and reports remain independent of the chosen chat host.

Implemented: host-driven participant loop; screenshots and visible observations returned directly in MCP results; browser isolation; reports; axe and keyboard interaction; rounds and conservative synthesis; MCP tools/resources/prompts; cancellation and duplicate-action protection. Verified with automated fixture and MCP transport tests, not real-human studies or every individual chat product's UI.

Deferred: native Maestro execution, product-discovery and separate first-impression/exploratory tools, automatic round comparison, additional reasoning providers, trace/video capture, and expanded accessibility interaction analysis. The `ProductDriver` abstraction includes the mobile extension point; this release does not claim native-mobile support. No dashboards, cloud infrastructure, billing, accounts, or CI/CD are included.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Tests cover actual Chromium navigation, image tool results, evidence files, axe violations, keyboard navigation, blocked HTTP mutations/redirects, three-participant storage isolation, API-free MCP stdio sessions with no sampling capability, follow-up decisions/findings, duplicate-action rejection, action limits, timeouts/cancellation, schema validation, severity, clustering, and report escaping. Deterministic test doubles are confined to tests/demo; production has no silent mock fallback.

References: [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/), [MCP tool results](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing). The original build brief remains preserved. The user's later requirement to use chat subscriptions supersedes its direct-provider/API examples; this requirement is recorded in `AGENTS.md`.

## Guided project setup

In your connected MCP chat, ask:

> Set up a usability test for [URL]. Ask me about the product, its users, the journey that matters, what success looks like, and testing boundaries. Propose a plan for me to review, then start with one synthetic participant.

The host uses `usability_setup_project` to ask five questions. It turns your answers into personas, neutral scenarios and goals, and observable success criteria. It saves the draft with `usability_save_project`, shows you the complete plan, then records your acceptance with `usability_approve_project`. Approval is a host attestation of your chat response, not an independently verified authorization.

`usability_run_project` takes the saved project ID, journey ID, and participant count (default **1**). To try three, the approved plan must contain at least three personas. Continue the normal observation/action/findings tool loop. The same subscription supplies reasoning; there are no model API calls.

For another run, ask:

> Reuse my saved project plan. Ask what changed and which journey to retest. Run three participants if the plan has three personas.

Use `usability_list_projects` to find profiles and `usability_setup_project` with a project ID to retrieve one. Unchanged approved plans can be reused. Changes are saved under a new draft ID and require review; the previous plan remains available. Profiles persist under the ignored `.usability/projects/` directory. Each project run stores its exact setup in `project.json`; retrieve it with `usability_get_report` using `format: "project"`.

After the run, the host compares the saved success criteria with journey evidence, marking each **observed**, **not observed**, or **inconclusive**, with evidence references. This comparison is host-generated; the saved core report retains its existing task outcomes and evidence-linked findings. Owner priorities and evaluator criteria are excluded from participant tool payloads. Host context isolation still depends on the chat product; exclusion from a payload cannot erase information already in the conversation.

Profile runs retain default-deny consequential-action protection. Written custom boundaries require host oversight and are not automatically translated into browser restrictions. Keep tasks consistent with those boundaries. Do not put credentials in profiles; authentication setup is not automated. These are synthetic participants, not recruited people.

## Diagnosing interrupted tests

Reports and final MCP responses now include **browser policy diagnostics**: the reason category, request method, resource type, request/redirect phase, and whether the block stops the journey. These diagnostics omit request URLs, query strings, credentials, headers and response bodies. They belong to the evaluator/report, not the participant's observation payload.

Forbidden requests remain blocked. Blocks of passive resources (such as an image or embedded frame) can now let the journey continue, with an explicit warning that the page may differ from an ordinary browser. Blocked main-frame navigation and unapproved write requests still stop the run. Do not turn missing content caused by these restrictions into a website usability finding. Diagnostics cover HTTP request/redirect policy decisions; they are not a complete browser-network trace.

Generic execution failures also record their stage, such as startup, observation, action or participant reasoning. The earlier slow-navigation fix waits longer for clicks and retries observations when navigation replaces the document; it never repeats the participant's action automatically.

Saved-project runs accept an optional `options` object with `timeoutMs` (up to 600000), `maxActions`, `accessibilityChecks`, `viewport`, and `interactionMode`. For example:

```json
{
  "projectId": "project-<saved-id>",
  "journeyId": "understand-adhd",
  "participantCount": 1,
  "options": { "timeoutMs": 600000, "accessibilityChecks": false }
}
```

These options are recorded alongside the approved plan in the run's `project.json`. They do not enable consequential capabilities or change the plan's target, persona, scenario or goal. Browser state still cannot resume after a stopped run or server restart; a continuation must be explicitly reported as a new session, not as an uninterrupted journey or an independent new participant.
