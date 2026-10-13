# Codex Build Brief — Usability MCP

## Working name

**Usability MCP**

A local-first MCP server that lets AI coding agents run synthetic, human-like usability testing sessions against digital products.

The product should be **UX-research-first**, not QA-first.

It should answer:

> Can a first-time human understand this interface and complete a realistic goal without being told how the product works?

The first release must support:
- websites
- web apps
- mobile web
- native mobile apps on local simulator/emulator

The architecture must allow more product drivers later without rewriting the UX methodology.

---

# 1. Product principles

## 1.1 Test the interface, not the implementation

The synthetic participant must interact with the product through the visible / accessible UI.

Do not use source code, route definitions, component names, database state, API schemas, test IDs, or hidden implementation details to decide what a user should do.

Implementation-aware inspection may be offered as a separate diagnostic mode **after** the usability session, never during the simulated-user session.

## 1.2 Observe behaviour, not opinions

The core evidence is:
- what the participant tried to do
- what they clicked/tapped
- where they hesitated
- where they backtracked
- what they misunderstood
- whether the task was completed
- what interface state caused the problem

Do not substitute a generic heuristic review for an actual task attempt.

## 1.3 Do not lead the participant

The agent running the participant should know:
- the persona
- the scenario
- the task / goal

It should not be told:
- which button to press
- which screen contains the answer
- which navigation path is expected
- the intended information architecture
- internal product terminology unless the persona would realistically know it

## 1.4 Think aloud, but treat it as synthetic evidence

The participant should produce concise observable commentary such as:
- "I expected pricing to be in the navigation."
- "I'm not sure whether Continue saves my progress."
- "I thought this icon was for settings."
- "I can't tell which option is required."

Do not invent emotions, demographics, disabilities, motivations, or past experiences beyond the supplied persona.

Synthetic think-aloud output must always be labelled as **simulated**, not as evidence from a real human participant.

## 1.5 Find the important problems first

Prioritise a small number of meaningful usability problems over a huge checklist.

A usability issue is more important when it:
- blocks task completion
- causes repeated wrong turns
- produces a serious misunderstanding
- causes data loss or fear of data loss
- hides a critical next action
- prevents recovery
- affects accessibility
- occurs across multiple synthetic participants
- is likely to affect a common user journey

## 1.6 Prefer iterative testing

The tool must make it easy to:
1. run a session
2. fix the most serious issues
3. rerun the same scenario
4. compare results

This is more important than producing a fake universal usability score.

---

# 2. Methodology guidance

The research behaviour should be inspired by Steve Krug's usability principles from:

- **Don't Make Me Think, Revisited**
- **Rocket Surgery Made Easy**

Do not copy book text into the project.

Translate the ideas into product behaviour:

### From Don't Make Me Think

Evaluate whether:
- controls and choices are self-evident
- users need unnecessary mental effort to understand what to do
- pages/screens support scanning rather than requiring careful reading
- visual hierarchy communicates importance
- navigation answers "where am I?", "where can I go?", and "how do I get back?"
- labels use familiar language
- unnecessary words or choices slow the user down
- interaction conventions are predictable
- mobile experiences remain clear with limited space and attention

### From Rocket Surgery Made Easy

The testing engine should:
- observe someone attempting realistic tasks
- favour simple, frequent, qualitative tests
- avoid leading the participant
- collect think-aloud observations
- focus debriefing on the most serious issues
- make testing easy enough to repeat often
- compare repeated rounds after fixes
- support testing rough or incomplete products when technically possible

The automated tool is **not a replacement for real-user research**. Reports must explicitly distinguish synthetic findings from evidence obtained from real participants.

---

# 3. Architecture

Use **TypeScript + Node.js**.

Suggested top-level architecture:

```text
Codex / Claude Code / Cursor / MCP Host
                 |
                 | MCP
                 v
+--------------------------------------+
|              Usability MCP           |
|--------------------------------------|
| Session Orchestrator                 |
| Persona Engine                       |
| Task Planner                         |
| UX Observation Engine               |
| Accessibility Engine                |
| Evidence Recorder                    |
| Report Generator                     |
+------------------+-------------------+
                   |
                   | ProductDriver
                   v
     +-------------+-------------+
     |                           |
     v                           v
Playwright Driver           Maestro Driver
Web / Web app /           iOS / Android /
Mobile web                 RN / Flutter
```

Do not couple UX evaluation directly to Playwright.

---

# 4. ProductDriver interface

Create a driver abstraction roughly like:

```ts
export interface ProductDriver {
  kind: 'web' | 'mobile';

  start(config: DriverStartConfig): Promise<void>;
  stop(): Promise<void>;

  getObservation(): Promise<ProductObservation>;

  click(target: InteractionTarget): Promise<ActionResult>;
  tap(target: InteractionTarget): Promise<ActionResult>;
  type(target: InteractionTarget, value: string): Promise<ActionResult>;
  scroll(direction: 'up' | 'down' | 'left' | 'right'): Promise<ActionResult>;
  pressKey(key: string): Promise<ActionResult>;
  goBack(): Promise<ActionResult>;

  screenshot(label?: string): Promise<EvidenceArtifact>;

  getAccessibilitySnapshot(): Promise<AccessibilitySnapshot | null>;
  getCurrentLocation(): Promise<string | null>;
}
```

The evaluator must consume normalized `ProductObservation` objects rather than Playwright/Maestro-specific structures.

---

# 5. Drivers

## 5.1 Web driver — Playwright

Use Playwright for:
- websites
- web apps
- localhost apps
- staging URLs
- mobile-web emulation

Observation should combine:
- screenshot
- visible text
- accessibility tree / semantic information
- viewport
- current URL
- interactive-element candidates
- dialogs / overlays
- browser errors where useful

Important:

The participant decision loop must not rely only on DOM selectors.

Visual evidence matters because usability includes:
- hierarchy
- prominence
- visual grouping
- density
- competing CTAs
- discoverability
- apparent affordance

Use accessibility/DOM information primarily to make selected actions reliable after the model has chosen an action based on the user-facing interface.

## 5.2 Mobile driver — Maestro

Use Maestro CLI as the initial native-mobile adapter.

Target:
- Android emulators
- iOS simulators
- React Native
- Flutter
- native apps

The driver should expose the same normalized observation/action interface.

Where exact semantic information is unavailable, combine:
- screenshot
- Maestro hierarchy/accessibility information where available
- visible text
- device state

Do not block the web MVP on full native-mobile parity.

Build the interface now; implement native mobile immediately after the web vertical slice is working.

---

# 6. AI reasoning provider

Create a provider interface:

```ts
export interface ReasoningProvider {
  decideNextAction(input: ParticipantDecisionInput): Promise<ParticipantDecision>;
  evaluateObservation(input: EvaluationInput): Promise<UXObservation[]>;
  synthesizeReport(input: ReportInput): Promise<UsabilityReport>;
}
```

Design for:
- OpenAI
- Anthropic
- local/Ollama
- MCP sampling if the host supports it

For V1, implement one provider cleanly but do not leak provider-specific code into session logic.

Configuration should be environment-based.

---

# 7. Synthetic participant model

A persona must be lightweight and task-relevant.

Example:

```json
{
  "name": "Alex",
  "ageRange": "35-50",
  "context": "Runs a small trade business",
  "technicalConfidence": "average",
  "productKnowledge": "none",
  "constraints": [
    "busy",
    "using the product for the first time"
  ]
}
```

Avoid theatrical personas.

Do not invent detailed psychology.

Persona attributes should only exist if they plausibly affect interaction behaviour.

Allow:
- user-provided persona
- generated persona
- multiple personas
- accessibility-oriented interaction modes

---

# 8. Session modes

Implement these concepts.

## 8.1 First impression

Show only the initial screen.

Ask the participant engine to infer:
- what this appears to be
- who it seems to be for
- what appears most important
- what action it expects is primary

This is diagnostic and should not contaminate the subsequent task session unless intentionally configured.

## 8.2 Task-based usability session

Inputs:
- product
- persona
- scenario
- goal
- max actions
- timeout
- viewport/device

Example scenario:

> You run a small business and are looking for accounting software. You found this product through Google.

Goal:

> Find the monthly price for a plan suitable for your business and begin signing up.

The participant receives the goal, not the route.

## 8.3 Exploratory session

Participant explores without a tightly specified route and identifies:
- what can be done
- navigation model
- unclear terminology
- discoverability issues
- trust questions
- dead ends

Use this carefully. Task-based tests should be the default.

## 8.4 Accessibility session

Run:
- automated accessibility checks where supported
- keyboard-only web journey
- focus order / focus visibility observations
- zoom / responsive checks
- reduced-motion checks where practical
- accessible names / roles / labels
- form error communication

For web, integrate `@axe-core/playwright`.

Do not claim automated checks equal a full WCAG conformance audit.

Native-mobile accessibility should be implemented through the mobile driver and platform semantics incrementally.

---

# 9. Agent decision loop

A task session should behave approximately as follows:

```text
START SESSION
  |
  v
capture current interface state
  |
  v
participant interprets what is visible
  |
  +--> record confusion / expectation / hesitation if present
  |
  v
choose ONE next user action
  |
  v
execute action through ProductDriver
  |
  v
capture resulting state + evidence
  |
  v
did the participant achieve the goal?
  |        |
  | no     | yes
  v        v
repeat     finish
  |
max actions / blocked / impossible
  |
  v
finish as incomplete
```

Do not ask the model to generate the entire journey up front.

Each next action must be chosen from the current observed state.

---

# 10. Decision schema

Use strict structured output.

Example:

```ts
type ParticipantDecision = {
  stateSummary: string;

  userExpectation?: string;

  selectedAction:
    | {
        type: 'click' | 'tap';
        targetDescription: string;
      }
    | {
        type: 'type';
        targetDescription: string;
        value: string;
      }
    | {
        type: 'scroll';
        direction: 'up' | 'down' | 'left' | 'right';
      }
    | {
        type: 'back';
      }
    | {
        type: 'finish';
        reason: string;
      };

  confidence: number;

  friction?: {
    category:
      | 'navigation'
      | 'comprehension'
      | 'affordance'
      | 'content'
      | 'form'
      | 'feedback'
      | 'error-recovery'
      | 'trust'
      | 'accessibility'
      | 'visual-hierarchy'
      | 'other';

    description: string;
  };
};
```

`confidence` is the simulated participant's confidence in their next action.

Do not convert this into a bogus "human confidence percentage" in user-facing research conclusions.

---

# 11. Evidence model

Every issue must be traceable to evidence.

Capture:
- session ID
- step number
- timestamp
- screenshot before action
- selected action
- screenshot after action when useful
- interface state summary
- participant observation
- current URL or app screen identifier
- accessibility result if relevant

Optional:
- Playwright trace
- video
- console/network logs

Keep evidence artifacts in:

```text
.usability/
  sessions/
    <session-id>/
      session.json
      report.md
      report.json
      screenshots/
      accessibility/
      traces/
```

Add `.usability/` to `.gitignore` by default except example fixtures.

---

# 12. Usability issue model

```ts
type UsabilityIssue = {
  id: string;

  title: string;

  category:
    | 'navigation'
    | 'comprehension'
    | 'affordance'
    | 'content'
    | 'form'
    | 'feedback'
    | 'error-recovery'
    | 'trust'
    | 'accessibility'
    | 'visual-hierarchy'
    | 'other';

  severity: 'critical' | 'high' | 'medium' | 'low';

  evidence: {
    sessionId: string;
    stepNumbers: number[];
    screenshots?: string[];
  }[];

  observedBehaviour: string;

  likelyUsabilityProblem: string;

  recommendation: string;

  participantsAffected: string[];

  taskImpact:
    | 'blocked'
    | 'major-delay'
    | 'minor-delay'
    | 'no-task-impact';

  confidence: 'high' | 'medium' | 'low';
};
```

Separate:
- observed behaviour
- interpretation
- recommendation

Do not present an inference as an observed fact.

---

# 13. Severity guidance

### Critical

Participant cannot complete a primary task, creates destructive consequences, or encounters a major accessibility blocker.

### High

Participant can potentially continue but experiences a serious wrong turn, misunderstanding, repeated failure, or major friction.

### Medium

Noticeable friction, hesitation, unclear wording, weak hierarchy, unnecessary work, or recoverable confusion.

### Low

Minor polish issue that has plausible usability impact but does not meaningfully disrupt the task.

Do not inflate severity.

---

# 14. Report design

Produce BOTH:

```text
report.json
report.md
```

Markdown structure:

```md
# Usability Test Report

## Test setup
Product:
Platform:
Date:
Scenario:
Goal:
Participants:
Synthetic testing disclaimer:

## Executive summary
Short factual summary.

## Task outcomes

| Participant | Outcome | Actions | Wrong turns | Backtracks |

## Most important findings

### U-001 — [issue]
Severity:
Participants affected:
Task impact:

Observed behaviour:
...

Why this may be a usability problem:
...

Evidence:
...

Recommendation:
...

## Participant journeys

### Alex
Step-by-step journey...

## Accessibility findings

### Automated
axe results...

### Interaction
keyboard / focus / semantic issues...

## Positive observations
Things that clearly helped users succeed.

## Limitations
These are synthetic participants and must not be represented as real-user evidence.
```

Do not create a single overall usability score in V1.

---

# 15. Multi-participant synthesis

For a normal round, default to **3 synthetic participants** with meaningfully different but relevant contexts.

Do not create random diversity for its own sake.

After sessions complete:
- cluster similar problems
- preserve individual evidence
- identify recurring problems
- distinguish one-off observations
- rank by severity + task impact + recurrence

Do not claim statistical significance.

---

# 16. Accessibility

## Web

Install:

```bash
npm install -D @axe-core/playwright
```

Run automated scans at meaningful interface states, not just page load.

Also test manually through automation:
- Tab
- Shift+Tab
- Enter
- Space
- Escape
- arrow keys where appropriate

Observe:
- visible focus
- focus order
- keyboard traps
- focus movement after dialogs/actions
- form errors
- announcements / live regions where technically observable

Use axe results as evidence, not as a complete accessibility verdict.

## Mobile

V1 native mobile:
- use UI/accessibility hierarchy exposed by the driver
- identify unlabeled/ambiguous controls where possible
- test tap targets and interaction flow
- record obvious visual accessibility concerns

Full screen-reader automation can be a later capability.

---

# 17. MCP server

Use the current stable MCP TypeScript server SDK.

Prefer local `stdio` for V1.

Expose high-level tools.

## Required MCP tools

### `usability_discover_product`

Purpose:
Inspect a product enough to propose likely user tasks without reading source code.

Input:
```json
{
  "target": "http://localhost:3000",
  "platform": "web"
}
```

Output:
- product surface summary
- likely primary journeys
- suggested test tasks
- uncertainty

---

### `usability_run_session`

Input concept:

```json
{
  "target": "http://localhost:3000",
  "platform": "web",
  "persona": {
    "context": "small business owner",
    "technicalConfidence": "average",
    "productKnowledge": "none"
  },
  "scenario": "You found this product while searching for invoicing software.",
  "goal": "Find the price of a suitable plan and begin signing up.",
  "maxActions": 30,
  "viewport": "desktop",
  "accessibilityChecks": true
}
```

Return:
- session status
- task outcome
- top findings
- artifact paths
- report path

---

### `usability_run_round`

Run multiple independent participants.

Input:
- target
- task
- participant count
- persona-generation constraints
- platform
- accessibility mode

Default participant count: 3.

---

### `usability_run_accessibility`

Run the platform-appropriate accessibility checks.

---

### `usability_compare_rounds`

Compare two previous test rounds after design changes.

Return:
- resolved issues
- persisting issues
- regressions
- new issues

---

### `usability_get_report`

Return the structured report / artifact location for a prior session or round.

---

# 18. MCP resources

Expose session artifacts as resources where practical.

Examples:

```text
usability://sessions/<id>/report
usability://sessions/<id>/journey
usability://sessions/<id>/accessibility
```

---

# 19. MCP prompt templates

Expose reusable prompts:

### `run-usability-test`

Should guide the host agent to:
- identify / confirm the product target
- propose realistic task(s)
- run three synthetic participants
- synthesize findings
- avoid changing code until the user explicitly asks for fixes

### `retest-after-fixes`

Should:
- locate prior round
- rerun same scenarios
- compare outcomes
- report regressions

---

# 20. Product discovery vs usability testing

Keep these separate.

Discovery may inspect enough of the visible product to propose tasks.

The participant session must begin with a **fresh browser/device session** so discovery knowledge does not leak into the simulated user's behaviour.

This is essential.

---

# 21. Web MVP vertical slice

Build this first and make it excellent.

A user should be able to:

1. install dependencies
2. run a local web app
3. start the MCP server
4. connect Codex
5. say:

> Run a usability test on http://localhost:3000. Use three realistic first-time users. Test the primary conversion journey and accessibility. Do not modify the code. Give me the most important usability problems with screenshots.

6. receive:
   - three independent task sessions
   - screenshots
   - task outcomes
   - axe accessibility findings
   - aggregated usability report

Only after this works should native-mobile execution be completed.

---

# 22. Native-mobile vertical slice

Next, implement Maestro adapter.

Expected invocation concept:

```json
{
  "platform": "mobile",
  "driver": "maestro",
  "appId": "com.example.app",
  "device": "ios-simulator",
  "goal": "Create an account and add the first item"
}
```

The report format must be identical to web.

---

# 23. Suggested project structure

```text
usability-mcp/
├─ src/
│  ├─ index.ts
│  ├─ mcp/
│  │  ├─ server.ts
│  │  ├─ tools/
│  │  ├─ resources/
│  │  └─ prompts/
│  ├─ core/
│  │  ├─ session-orchestrator.ts
│  │  ├─ participant.ts
│  │  ├─ decision-loop.ts
│  │  ├─ evaluator.ts
│  │  ├─ synthesis.ts
│  │  └─ types.ts
│  ├─ drivers/
│  │  ├─ product-driver.ts
│  │  ├─ playwright/
│  │  │  ├─ driver.ts
│  │  │  ├─ observation.ts
│  │  │  └─ targeting.ts
│  │  └─ maestro/
│  │     └─ driver.ts
│  ├─ reasoning/
│  │  ├─ provider.ts
│  │  └─ openai.ts
│  ├─ accessibility/
│  │  ├─ axe.ts
│  │  └─ keyboard.ts
│  ├─ evidence/
│  │  ├─ recorder.ts
│  │  └─ artifacts.ts
│  ├─ reports/
│  │  ├─ markdown.ts
│  │  └─ json.ts
│  └─ config/
│     └─ schema.ts
├─ tests/
│  ├─ fixtures/
│  ├─ unit/
│  └─ integration/
├─ examples/
├─ .env.example
├─ .gitignore
├─ package.json
├─ tsconfig.json
├─ README.md
└─ AGENTS.md
```

---

# 24. Engineering requirements

- TypeScript strict mode
- Zod schemas at all external boundaries
- structured model output
- deterministic artifact paths
- abort/timeout support
- max action limits
- redact secrets from logs
- never submit real payments
- never send real messages/emails unless test environment explicitly allows it
- configurable destructive-action guard
- fresh context per synthetic participant
- unit tests for clustering/severity/reporting
- integration tests against a small local fixture site
- graceful failure when browser/device unavailable

---

# 25. Test safety

Default deny:
- purchases
- money movement
- deletion of real data
- posting public content
- sending communication
- account closure
- irreversible actions

Allow an explicit `testEnvironment: true` + per-capability opt-in to relax safeguards in known test environments.

---

# 26. Important anti-patterns

Do NOT:

- call a static heuristic review a "usability test"
- inspect code to help the synthetic user succeed
- precompute the expected click path
- give the participant selectors
- let discovery-session memory leak into participant sessions
- generate dozens of low-value findings
- invent human emotions
- claim synthetic users replace real participants
- claim axe equals WCAG compliance
- assign scientific validity to a synthetic usability score
- automatically edit product code after testing unless explicitly requested

---

# 27. Phase plan

## Phase 1 — repository + MCP skeleton
- initialize Node/TS project
- MCP stdio server
- health/test tool
- config schema
- artifact directories

## Phase 2 — Playwright ProductDriver
- browser lifecycle
- screenshots
- semantic/accessibility snapshot
- normalized observations
- action targeting

## Phase 3 — one synthetic participant
- persona
- scenario + goal
- iterative decision loop
- task completion / fail logic
- evidence capture

## Phase 4 — UX observations
- friction classification
- severity
- journey recording
- report JSON + Markdown

## Phase 5 — accessibility
- axe-core
- keyboard journey
- accessibility report section

## Phase 6 — multi-participant round
- 3 isolated participants
- clustering
- aggregated findings
- recurrence analysis

## Phase 7 — MCP UX
- high-level run tool
- report resource
- reusable MCP prompts
- README setup for Codex

## Phase 8 — Maestro mobile adapter
- simulator/emulator control
- normalized screenshots/state
- click/tap/type/back
- reuse same participant engine

## Phase 9 — comparison/regression mode
- rerun saved scenario
- compare rounds
- resolved / persistent / regression findings

---

# 28. MVP acceptance criteria

The MVP is done when all are true:

1. Codex can connect to the server via MCP.
2. The server can test a localhost website.
3. A participant gets only persona + scenario + goal, not a prescribed route.
4. The agent chooses actions iteratively from current UI state.
5. Each important action has screenshot evidence.
6. Three participants run in isolated sessions.
7. The report distinguishes observed behaviour from interpretation.
8. axe-core runs on important states.
9. keyboard accessibility can be exercised.
10. report.md and report.json are generated.
11. the top findings are returned through MCP.
12. rerunning against the same app is possible.
13. no product code is modified by default.

---

# 29. References to consult while building

Prefer official docs.

- Steve Krug — Don't Make Me Think:
  https://sensible.com/dont-make-me-think/

- Steve Krug — Rocket Surgery Made Easy:
  https://sensible.com/rocket-surgery-made-easy/

- TestSprite MCP architecture inspiration:
  https://www.testsprite.com/blog/what-is-testsprite-mcp-server-and-how-does-it-work

- TestSprite UX/UI testing:
  https://www.testsprite.com/use-cases/en/ux-and-ui-testing

- TestSprite accessibility:
  https://www.testsprite.com/use-cases/en/ai-accessibility-testing-tool

- MCP TypeScript SDK:
  https://ts.sdk.modelcontextprotocol.io/v2/

- Playwright:
  https://playwright.dev/

- axe-core Playwright:
  https://playwright.dev/docs/accessibility-testing

- Maestro:
  https://docs.maestro.dev/

Use these for architecture and behaviour inspiration only. Do not copy proprietary implementation or marketing language.

---

# 30. Initial Codex instruction

Use the following as the first message to Codex after placing this file in a new repository.

```text
Read CODEX_BUILD_BRIEF_USABILITY_MCP.md completely before making changes.

Build this project as a local-first MCP server for synthetic usability testing.

Work in phases and keep the repository runnable at the end of each phase.

Start with the WEB MVP vertical slice only, but create the ProductDriver abstraction now so Maestro/native-mobile can be added without rewriting the core.

Important product behaviour:

- This is a usability-testing system, not primarily a QA test generator.
- The synthetic participant must use the visible interface and must not inspect source code to figure out how to complete its task.
- Give the participant only a persona, scenario and goal.
- Let it choose one action at a time based on the current screenshot + user-facing semantic state.
- Record hesitation, wrong turns, backtracking, misunderstandings and task outcome.
- Keep observations separate from interpretations.
- Integrate @axe-core/playwright for accessibility.
- Preserve screenshots as evidence.
- Never modify the target product during a testing run.
- Reports must say clearly that findings come from synthetic participants.
- Do not add an overall usability score.

Technical direction:

- TypeScript / Node.js
- current stable MCP TypeScript server SDK
- stdio transport for V1
- Playwright web driver
- @axe-core/playwright
- Zod
- strict TypeScript
- JSON + Markdown reports
- local artifact storage under .usability/

First implementation milestone:

1. Scaffold the repository.
2. Implement the MCP server.
3. Implement ProductDriver.
4. Implement PlaywrightProductDriver.
5. Add a `usability_run_session` MCP tool.
6. Make one synthetic participant navigate a local fixture website iteratively.
7. Save screenshots and a JSON journey.
8. Generate a basic Markdown report.
9. Add automated tests.
10. Add README instructions showing exactly how to connect this MCP server to Codex.

Do not implement dashboards, accounts, cloud infrastructure, CI/CD, billing, or TestSprite-style broad QA features.

After the first vertical slice works, review the architecture against the full build brief and proceed to multi-participant synthesis and accessibility.

When a technical choice is uncertain, prefer the simplest local implementation that preserves the ProductDriver abstraction and evidence trail.

Begin by showing me:
- the proposed package.json dependencies
- final folder structure
- the exact MCP tool schema for usability_run_session
- the reasoning loop design

Then implement it.
```

---

# 31. Product north star

A successful session should feel less like:

> "AI reviewed my UI."

and more like:

> "I watched three unfamiliar people try to use my product, saw where they got confused, and now I know the few things I should fix first."

That is the standard the implementation should optimise for.
