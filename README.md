# Usability Test MCP

A local-first MCP server for **synthetic usability testing** of websites and mobile web. Participants choose one action at a time from the current screenshot and visible UI semantics. The server stores journeys, screenshots, axe results, and evidence-linked JSON/Markdown reports.

**Use your existing chat subscription in an MCP-capable host. No AI API key, direct provider API call, or separate API billing is required.** The connected chat supplies decisions; this local server controls the browser and records the evidence. Your host's normal plan limits and tool permissions still apply.

Synthetic participants are not real people. Their commentary and completion judgments must not be represented as real-user research. There is no overall usability score, and automated accessibility checks are not a WCAG conformance audit.

## Install once, test from chat

Requires **Node.js 22+**, npm, Git, and the chosen host CLI. The GitHub repository is currently private: installers need repository access and Git authentication. No npm account, model API key or separate model billing is needed.

**Codex:**

```bash
npx --yes github:gabrielhidalgow/usability-test-mcp setup --host codex
```

**Claude Code:**

```bash
npx --yes github:gabrielhidalgow/usability-test-mcp setup --host claude-code
```

**Claude Desktop on macOS:** use `--host claude-desktop`. The old `--host claude` alias still means Desktop, not Claude Code.

The command builds a durable local copy, installs Chromium, checks the browser, and registers the MCP with the selected host. Restart the host / refresh its MCP connection and enable its tools. In Claude Code check `/mcp`; ask either host to call `usability_health`.

Then just ask:

> Quickly test https://example.com on mobile. The user is a first-time visitor trying to find the right plan and its monthly cost.

The host calls `usability_quick_test`, observes screenshots, chooses each action, and returns the report. Quick mode uses one participant, up to 12 actions, ten minutes, and no axe scan unless requested. It requires a goal; it does not invent one or require a saved profile. Use the guided project questionnaire when you want a reusable plan.

`device: "mobile"` means a phone-sized Chromium browser, not native iOS/Android or actual Mobile Safari. Desktop and mobile web share the same browser policy and evidence/report pipeline.

## Compare three synthetic participants

Ask: **“Test [URL] with three different synthetic participants trying to [goal]. Compare recurring problems and successful paths, then finish the UX and content reviews.”** This uses `usability_quick_test` with `participantCount: 3`. One participant remains the default.

Each participant starts at the same URL with the same task and device. Default profiles vary prior knowledge, technical confidence, and information needs; they are explicitly assumptions. For research-informed profiles, use guided project setup, identify supporting owner research, and review the proposed profiles. Existing approved profiles remain usable; older profiles show an unspecified basis.

Browsers and supplied histories are isolated. Hosts should hand only the participant packet to a fresh model context where supported and report `contextIsolation` on the first decision: `shared`, `host-reported fresh`, or `unknown`. The MCP cannot create or verify fresh host contexts, remove prior chat knowledge, or guarantee independent reasoning. Missing declarations remain unknown. Do not force mistakes, emotional responses or different routes to make profiles appear distinct.

Rounds now finish **all journeys before interpretation**. The host then follows `usability_get_review` / `usability_submit_review` through four saved stages: participant findings, pattern synthesis, UX review, and content review. A browser run marked finished may still have pending reviews. Each submission uses the current revision; exact retries are safe and stale changes are rejected. Reviews resume after a server restart without browser actions. To inspect screenshots, call `usability_get_review` with the round ID, session ID and step number.

Patterns group related evidence by the visible interface and obstacle, not identical titles. Each includes assessments for every stable participant ID: experienced, successful, not-observed, or inconclusive. Successful/experienced assessments require recorded evidence. Duplicate names do not collapse participants; continuation segments count once. Uncertain groups can be omitted so individual findings stay ungrouped. Invalid submissions leave the last saved report intact.

The report preserves individual findings and shows successful paths, conflicting evidence, incomplete journeys, assumptions and isolation limitations. UX/content recommendations are separate expert interpretations and never increase participant counts. Grouping remains a host judgment; validation checks references, not whether an interpretation is objectively true. “Observed in two simulated journeys” is qualitative evidence, not a population percentage or proof of human behaviour. Shared model bias may recur across profiles.

Comparison mode supports desktop and mobile web. Native rounds remain unsupported.

## Continue an interrupted web test

Ask: **“Continue session-… from where it stopped.”** `usability_continue_session` reads its saved checkpoint after restart, opens the last observed same-origin URL in a fresh browser and includes only that participant's prior decisions/history. It never replays a click, resubmits a form or copies old findings into participant context. Active runs should use `usability_get_session_state`; cancel them before continuing. Completed runs cannot be continued.

This is a **linked continuation segment**, not restoration of cookies, login, form values, scroll position or back history. Reports store the parent/root IDs and clearly label the reset. If the last action's result is unknown, that uncertainty is retained. Reassess the current UI before acting. Capability overrides are reset to default-deny. Native continuation is not yet supported.

Web captures now wait briefly for visible layout, fonts and finite animations. The wait is bounded at roughly two seconds and does not disable animations or wait indefinitely for network idle. Unsettled captures are flagged for review; automated contrast findings during transitions should be rechecked.

## Native apps — experimental

The same MCP includes `usability_run_native`, an experimental screenshot-driven adapter for **local Maestro**. It does not use Maestro Cloud or model APIs. You must separately install [Maestro and its prerequisites](https://docs.maestro.dev/get-started/installing-maestro), boot a disposable Android emulator or iOS simulator, and install a sandbox build of your app. Native prerequisites and a real device are not installed by the MCP setup command.

Check the setup with:

```bash
npx --yes github:gabrielhidalgow/usability-test-mcp doctor --native
```

Then ask your host to test an app by providing its app/bundle ID, device ID, operating system, audience and goal, and confirming that the device is prepared for testing. The tool requires `preparedTestDevice: true`.

The host receives a screenshot, chooses `tap_point` using normalized coordinates plus the visible control label, or `enter_text` after focusing a non-sensitive field. Scroll and Android back are supported. iOS back uses the visible back control. No source code, hidden hierarchy IDs or predetermined flow is provided to the participant.

**Limits:** this adapter is tested with a labelled command-runner fixture, not a real device on the development machine (Maestro, Java and simulator were unavailable). Treat it as experimental until your device smoke test passes. There is no native network interception, independent verification of tap labels, screenshot masking, app-data isolation/reset, or native accessibility audit. Permissions are denied at launch; permission-dependent features may be unavailable. The adapter does not stop or clear the app at session end. Use fake data and a prepared sandbox app; do not use personal devices or production accounts. Concurrent use of the same device is prevented only within one server process. Native rounds and saved native project profiles are not yet supported.

See [Maestro commands](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options) and [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp) for the underlying local integrations.

## Installation details

The host registration key (`usability`), tool names, and existing storage directory stay unchanged so upgrades retain reports and profiles. The product, package, executable and GitHub repository are now named **Usability Test MCP** / `usability-test-mcp`.

Default runtime: `~/.local/share/usability-mcp/runtime/`. Reports and profiles: `~/.local/share/usability-mcp/artifacts/`. Use `--dir "/absolute/path"` to change it. Stop active tests before updating; rerun setup to update while retaining artifacts. Host registration uses absolute Node/server paths; rerun setup if you move Node.

Automatic setup supports Codex and Claude Code on macOS/Linux, and Claude Desktop on macOS. `--host manual` prints configuration for another local MCP host. Linux may require separate administrator installation of Chromium system libraries; `doctor` reports browser launch failures. Windows automatic setup and remote-only chat connections are not included.

Claude configurations are merged with a backup when updating an existing entry; unrelated settings remain intact. Codex uses `codex mcp add`. Claude Code registers the server in **user scope** so it is available across projects. Existing entries named `usability` are updated. Reports, screenshots, tokens and local test data are excluded from the distributable.

For a pinned version append `#COMMIT_OR_TAG` to the GitHub package spec. Public distribution requires making the repository public or granting access; no npm registry publication is needed. The repository's `private` package flag prevents accidental npm publishing.

To uninstall, remove the MCP entry (`codex mcp remove usability` or `claude mcp remove --scope user usability`) and delete the installation's `runtime/` folder. Keep `artifacts/` to retain reports. Shared Playwright browser caches are left intact.

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
usability_run_session
  -> screenshot + visible state + persona/scenario/goal
  -> chat chooses one action
usability_advance_session
  -> next screenshot + visible state
  -> repeat until participant finishes
usability_submit_findings
  -> single-participant report

For rounds: repeat observation/action for every participant, then
usability_get_review -> usability_submit_review
  -> participants -> synthesis -> ux -> content -> complete
```

The server returns `nextTool` and a one-use `requestId` at each pause. The chat should continue until `phase: "finished"` and, for rounds, until the saved review stage is `complete`; starting a run is not completing it. Ordinary MCP tools and image results are used; **MCP sampling support is not required**. The server does not log in to a provider, reuse subscription tokens, scrape chat websites, or call a model endpoint.

The host normally starts the stdio server itself. `npm start` waits for MCP messages; it is not a web server. `.env` is optional and contains only local settings, such as `USABILITY_ARTIFACT_DIR` and `USABILITY_HEADLESS`; nothing needs to be configured for model credentials.

Screenshots and UI text are returned to your connected chat and handled under that host's data policies. Only test data you are authorized to share there. The server does not send target source code or response bodies to the host. Browser data is isolated per participant; **chat context is controlled by the host**, so use fresh model contexts where available and avoid running participants in a conversation that already knows the target implementation. If one chat runs all personas, treat them as separate browser journeys, not independently isolated model participants.

## Connect to Codex

Run `npm run build`. Add the following entry to your project-scoped `.codex/config.toml` (trusted project) or merge it into `~/.codex/config.toml`. Replace `/ABSOLUTE/PATH/usability-test-mcp` in every location with this repository's absolute path; paths containing spaces work inside the quoted strings.

```toml
[mcp_servers.usability]
command = "node"
args = ["/ABSOLUTE/PATH/usability-test-mcp/dist/src/index.js"]
cwd = "/ABSOLUTE/PATH/usability-test-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

If the desktop app cannot find Node, replace `node` with the output of `command -v node`. Restart the MCP connection/app and check `/mcp`, then ask Codex to call `usability_health`. It should return `reasoningMode: "connected-host-chat"` and `apiKeyRequired: false`. Each tool call only waits for browser work; chat thinking happens between calls.

Alternatively register through the CLI, then set `cwd` and `tool_timeout_sec` in the resulting entry:

```bash
codex mcp add usability -- node /ABSOLUTE/PATH/usability-test-mcp/dist/src/index.js
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
      "args": ["/ABSOLUTE/PATH/usability-test-mcp/dist/src/index.js"],
      "env": { "USABILITY_ARTIFACT_DIR": "/ABSOLUTE/PATH/usability-test-mcp/.usability" }
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
| `usability_quick_test` | Start a desktop or mobile-web journey from a URL, goal, and audience |
| `usability_continue_session` | Start a linked segment of an interrupted web journey with its saved history and a fresh browser |
| `usability_run_native` | Start an experimental native journey on a prepared Maestro test device |
| `usability_run_session` | Start one participant; returns screenshot and first decision request |
| `usability_run_round` | Start three participants by default; fresh browser contexts and combined report |
| `usability_run_accessibility` | Start a keyboard-only journey with axe scans |
| `usability_advance_session` | Validate and execute one host decision, then return the next request |
| `usability_submit_findings` | Save grounded interpretations after a participant finishes |
| `usability_get_session_state` | Recover the current request after a lost response without replaying an action |
| `usability_cancel_session` | Close an abandoned run and retain partial evidence |
| `usability_get_review` | Read the next saved review stage or inspect evidence screenshots |
| `usability_submit_review` | Validate and save participant interpretations, patterns, UX or content reviews |
| `usability_get_report` | Read JSON, Markdown, or journey by session/round ID |

`examples/session.json` is a complete session input. The authoritative Zod schema is `src/config/schema.ts`; MCP `tools/list` publishes its JSON Schema. Unknown fields are rejected.

Required session fields: `target`, `persona.context`, `scenario`, `goal`. Defaults: web, desktop, 30 actions, 180 seconds, accessibility checks enabled, standard interaction mode, no consequential capabilities. `platform: "mobile"` is rejected; `viewport: "mobile"` means mobile web. Use `usability_run_native` for the separate experimental native driver.

Round inputs replace `persona` with optional `personas`, `participantCount` (default 3, maximum 5), and `personaContext`. If you supply personas, their count must equal `participantCount`. Generated personas vary task-relevant technical confidence and constraints; they are templates, not demographic representation. The server resets browser storage and the supplied history per participant, but cannot reset the host's chat memory. Sessions run sequentially; `timeoutMs` includes time waiting for the chat's decisions and findings. Use up to 600000 ms for longer chat journeys.

Follow-up tools require the returned `runId` and `requestId`. A consumed request cannot execute twice. At `awaiting_decision`, submit a `decision` matching the published tool schema (state summary, simulated commentary, selected action, confidence, nullable expectation/friction, behavior). At `awaiting_findings`, submit up to eight evidence-linked `findings`, or `[]`. Single sessions request findings before their final report. Rounds automatically move to the next participant, deferring interpretation to the saved post-run review workflow. Do not call the start tool repeatedly to advance an existing run.

Abandoned runs time out and save partial reports. Live browser state is held in memory and cannot be restored after a server restart. Saved artifacts remain readable; `usability_continue_session` can start a linked web segment with the saved participant history in a fresh browser. At most four runs are active at once; the last 24 active/completed run states are cached. On connection shutdown the server cancels pending work and closes browsers. Use `usability_cancel_session` before leaving a test unfinished.

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

Reports keep executed actions, action results, simulated commentary, interpretations, recommendations, and evidence references separate. Findings with nonexistent steps or harness safety blocks are discarded. Severity follows task impact. New round reviews preserve individual findings and group related evidence through validated host submissions. Patterns rank by task-impact severity then the number of distinct participants who experienced the obstacle. Legacy reports retain their original grouping. No statistical significance is claimed.

## Safety and limitations

The browser guards below apply to web runs. Native runs have the separate experimental limitations described above, including no HTTP interception or screenshot masking.

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

Implemented: host-driven participant loop; screenshots and visible observations returned directly in MCP results; browser isolation; reports; axe and keyboard interaction; rounds with deferred evidence-based comparison and separate UX/content reviews; MCP tools/resources/prompts; cancellation and duplicate-action protection. Verified with automated fixture and MCP transport tests, not real-human studies or every individual chat product's UI.

Deferred: native real-device validation, native rounds/profile support, product-discovery and separate first-impression/exploratory tools, automatic comparison between separate test rounds, additional reasoning providers, trace/video capture, and expanded accessibility interaction analysis. The `ProductDriver` abstraction includes the mobile extension point; native support is experimental and requires the separately prepared Maestro device described above. No dashboards, cloud infrastructure, billing, accounts, or CI/CD are included.

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

`usability_run_project` takes the saved project ID, journey ID, and participant count (default **1**). To try three, the approved plan must contain at least three personas. For one participant, continue the observation/action/findings loop. For a round, finish all observation/action journeys and then complete the saved review stages. The same subscription supplies reasoning; there are no model API calls.

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

These options are recorded alongside the approved plan in the run's `project.json`. They do not enable consequential capabilities or change the plan's target, persona, scenario or goal. Use `usability_continue_session` for a linked web continuation with a fresh browser. It is not an uninterrupted journey or an independent new participant.
