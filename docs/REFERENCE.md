# Reference

[← Back to README](../README.md)

## How a test runs

The chat (Claude Code or Codex) does the reasoning through ordinary MCP tool calls. MCP sampling is not needed and no model API is called.

```text
usability_quick_test / usability_run_session / usability_run_project
  -> screenshot + visible state + profile, task and own history
  -> participant chooses one action
usability_advance_session
  -> next screenshot + visible state
  -> repeat until the participant finishes
usability_review_session (isolated run) or usability_submit_findings
  -> report

For several participants:
usability_combine_sessions or usability_run_round
usability_get_review -> usability_submit_review
  -> participants -> synthesis -> ux -> content -> complete
```

Each pause returns `nextTool` and a one-use `requestId`, so an action can never run twice. Keep going until `phase: "finished"` and, for rounds, until the review stage is `complete`. Starting a run is not finishing it.

Quick tests use one participant, up to 12 actions, ten minutes and no axe scan unless asked. They need a goal and never invent one. `device: "mobile"` means a phone-sized Chromium window, not a native app or real Mobile Safari.

## Watching a test

Web runs open a **visible Chromium window** by default (phone-sized for mobile). A highlighted pointer follows the real mouse, and a badge shows the participant, step and what is happening. Pauses while the chat thinks are normal. Watch without clicking; closing the window cancels the test and keeps partial evidence.

For background runs, set `presentation: "background"`, or `USABILITY_HEADLESS=true` as a default. Without a display the server says so; it never silently switches.

## MCP tools

| Tool | What it does |
| --- | --- |
| `usability_health` | Local status and reasoning mode (no API key) |
| `usability_quick_test` | Test a URL with a goal and audience, desktop or mobile web |
| `usability_setup_project` | Guided setup questionnaire, with an optional visible-page scan |
| `usability_discover_product` | Capture setup screens separately from participant journeys |
| `usability_get_discovery` | Read captured setup screens and where they came from |
| `usability_save_setup_suggestions` | Store sourced, editable draft answers |
| `usability_save_project` | Save a plan draft and return its task review |
| `usability_approve_project` | Record the owner's approval of a plan |
| `usability_list_projects` | List saved plans |
| `usability_preview_project_run` | Show which profiles a run will use |
| `usability_run_project` | Run a journey from an approved plan |
| `usability_run_session` | Start one participant |
| `usability_run_round` | Start several participants (three by default) |
| `usability_run_accessibility` | Keyboard-only journey with axe scans |
| `usability_advance_session` | Carry out one participant decision and return the next screen |
| `usability_submit_findings` | Save evidence-linked findings after a participant finishes |
| `usability_review_session` | Coordinator findings for a finished isolated session |
| `usability_combine_sessions` | Turn 2–5 isolated sessions of one task into a comparison round |
| `usability_get_review` / `usability_submit_review` | Work through a round's review stages |
| `usability_get_report` | Read a report (`markdown`, `details`, `journey`, `json`, `project`) |
| `usability_get_session_state` | Recover the current request after a lost response |
| `usability_cancel_session` | Stop a run and keep partial evidence |
| `usability_continue_session` | Linked continuation of an interrupted web test |
| `usability_compare_runs` / `usability_submit_run_comparison` | Baseline → retest comparison |
| `usability_plan_figma_flow` | Order a Figma section's screens and read `@tap` targets |
| `usability_import_figma_section` | Import a planned flow from one section render |
| `usability_import_figma_export` | Import a section PNG or a folder of exported frames |
| `usability_import_prototype` | Import static frames and optional tap targets |
| `usability_test_prototype` | Test an imported design flow |
| `usability_run_native` | Experimental native app journey on a prepared device |

The authoritative schemas are in `src/config/schema.ts`; `tools/list` publishes them as JSON Schema. Unknown fields are rejected. `examples/session.json` is a complete session input.

**Session defaults:** web, desktop, 30 actions, 180 seconds, accessibility checks on, no consequential capabilities. `timeoutMs` includes the chat's thinking time; use up to 600000 for long journeys. Up to four runs can be active at once.

**Status values:** sessions end `completed`, `incomplete`, `blocked`, `timeout`, `cancelled` or `error`. Completion is the model's evidence-based judgement. Rounds report execution (`finished`, `partial`, `cancelled`); check each participant's outcome rather than reading `finished` as success.

## Prompts

`run-usability-test`, `test-figma-flow`, `first-impression` (a scroll-only home-page tour, reported separately) and `retest-after-fixes`.

## Resources

```text
usability://sessions/<session-id>/report | journey | accessibility
usability://rounds/<round-id>/report | journey | accessibility
usability://methodology
```

`usability://methodology` holds the versioned review principles for facilitators and reviewers, never participants.

## Reports

Every test writes a short **`report.md`** and a full **`details.md`** appendix. See [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md).

1. **At a glance:** task, scope, completion and a participant table.
2. **Recommended actions:** at most three, most serious first, with screenshot evidence.
3. **Concrete changes:** the screen or control, the proposed copy, design or interaction change, and how to check it in a retest. Copy changes show current → proposed wording.
4. **What worked:** up to two things to keep.
5. **Evidence limits and next check.**

Recommendations never invent current copy, effort, owners, prices or promised outcomes. If there is no supported change, the report says so.

Observations, interpretations and recommendations are kept separate and linked to evidence. Findings that cite steps that do not exist, or harness safety blocks, are discarded. Severity follows task impact.

## Files

```text
artifacts/
  sessions/session-<id>/  session.json  report.json  report.md  details.md
                          screenshots/0001.png  accessibility/0000.json
  rounds/round-<id>/      round.json  report.json  report.md  details.md
  projects/  discoveries/  prototypes/
```

## Architecture

`SessionOrchestrator` depends on a `ProductDriver` (Playwright, prototype or native) and a `ReasoningProvider`. `HostReasoningProvider` pauses the loop for a decision from the chat; `HostSessions` connects those pauses to ordinary MCP calls. There is no model SDK. Evidence and reports do not depend on which chat you use.
