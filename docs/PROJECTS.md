# Guided setup, saved projects and retests

[← Back to README](../README.md)

Quick tests need only a URL and a goal. For anything you will run more than once, use a **saved project**: a reviewed plan with profiles, journeys, success criteria and boundaries.

## Guided setup

`/usability-test https://your-site.com` starts guided setup. You can also ask:

> Set up a usability test for [URL]. Ask me about the product, its users, the journey that matters, what success looks like, and testing boundaries.

1. **Scan.** `usability_setup_project` looks at the visible starting page and up to three same-origin pages linked from it. It reads rendered content, not source code, hidden routes or forms. This is setup discovery, not a participant journey.
2. **Drafts.** The chat drafts purpose, audience, possible journeys and success criteria and saves them with `usability_save_setup_suggestions`. Each draft names the screens it came from and says whether it was observed or assumed. You can edit, replace or remove any of them.
3. **Your questions.** Priorities, success, testing boundaries and focus must come from you. The chat asks only what is still unanswered. If scanning fails, or you prefer, answer the questionnaire directly.
4. **Review.** `usability_save_project` saves the draft and returns a `taskReview`: it flags tasks that give away the route (clicks, menus, URLs, quoted labels), unobservable success criteria, PDF or download tasks, and missing motivation. Nothing is rewritten; you decide.
5. **Approve.** `usability_approve_project` records your acceptance. This is a record of your reply in chat, not an independently verified authorisation.
6. **Run.** `usability_preview_project_run` shows the exact profile assignment; `usability_run_project` runs it (one participant by default). Participants run isolated ([CLEAN-PARTICIPANTS.md](CLEAN-PARTICIPANTS.md)) and never see discovery screens, suggested routes or your success criteria.

After the run, the chat marks each success criterion **observed**, **not observed** or **inconclusive**, with evidence.

**Not supported as tasks:** opening PDFs, downloads, popups and off-site navigation. Setup flags such success criteria and proposes something testable instead, such as finding the data-sheet link.

## Reusing a plan

> Reuse my saved project plan. Ask what changed and which journey to retest.

`usability_list_projects` finds plans; `usability_setup_project` with a project ID retrieves one. Unchanged approved plans can be reused. Changes are saved as a new draft that needs review; the old plan stays. Each run stores its exact setup in `project.json` (`usability_get_report` with `format: "project"`).

## Profiles and journeys

Give each profile a stable `id` (for example `specifier` or `installer`) and each journey an ordered `personaIds` list. With one participant, the first assigned profile is used. A three-perspective comparison needs three suitable profiles on the same task. IDs must be unique; display names may repeat. Older multi-profile plans without assignments must be edited and approved again; the tool no longer guesses.

Do not put credentials in profiles; login is not automated.

## Focus a test on a feature or page

A **focus area** narrows a test to one feature, page or flow, such as checkout or account settings.

- **In setup:** answer "Which feature, page or flow should this test focus on?" (leave blank to test from the home page). Each area has an `id`, `name`, optional `description`, a `startPath` such as `/checkout`, and `includePaths` such as `["/cart", "/checkout"]`. Each journey gets one `focusAreaId`; a plan holds up to eight.
- **In a quick test:** pass `focus: { name, startPath, includePaths }`.
- **During the run:** the participant starts on the focus page and is **never told the boundary**. Short detours are fine. After **3 steps in a row outside** (change with `leaveLimit`), the journey ends as "left the focus area", which is itself a finding.
- **In the report:** a **Focus** line shows the area and how many steps left it. The top actions cover the focus area only; findings entirely outside it get their own appendix section.
- **Paths:** `/pricing` also covers `/pricing/...`. `/` means the home page only. Paths must be same-origin prefixes. Things that live inside one URL (modals, tabs) can be described but not tracked.

## Three participants

> Test [URL] with three different synthetic participants trying to [goal]. Compare recurring problems and successful paths.

Use `participantCount: 3` (quick tests or projects). Each participant starts at the same URL with the same task and device. Default profiles vary prior knowledge, technical confidence and information needs, and are labelled as assumptions.

All journeys finish before interpretation. The chat then works through four saved review stages with `usability_get_review` / `usability_submit_review`: participant findings, pattern synthesis, UX review and content review. Reviews survive a restart.

Patterns group related evidence by interface and obstacle and record, for every participant, whether they experienced it, succeeded, did not meet it or were inconclusive. "Observed in two simulated journeys" is qualitative evidence, not a percentage of real users; the same model bias can recur across profiles. Native rounds are not supported.

## Corrections and reruns

To correct an invalid attempt (wrong profile, contaminated context, interruption), pass `rerun: { priorRunId, reason, changes }`. Reasons: `wrong-participant`, `policy-adjustment`, `context-contamination`, `interrupted`, `other`. Keep the same product, task and run type. Both attempts stay on disk; the old report is marked superseded and left out of current summaries. Correct the **whole round**, not one participant. A changed goal or product is a new test, not a correction.

## Retest after changes

Rerun the same task in a fresh context (the `retest-after-fixes` prompt, or `/usability-test retest <run-id>`), then call `usability_compare_runs` and `usability_submit_run_comparison`. Each earlier finding is marked observed again, not observed on a comparable path, or inconclusive. Different devices, profiles, tasks or focus areas are flagged as not comparable. Absence is never reported as a proven fix.

## Continue an interrupted web test

> Continue session-… from where it stopped.

`usability_continue_session` opens the last observed same-origin page in a fresh browser with only that participant's earlier history. It never replays a click or resubmits a form. This is a **linked continuation**: cookies, login, form values, scroll position and back history are reset, and the report says so. Completed runs cannot be continued; cancel active ones first. Native continuation is not supported.

## Run options

Project runs accept `options` with `timeoutMs` (up to 600000), `maxActions`, `accessibilityChecks`, `viewport`, `interactionMode`, `presentation`, `contextCheck`, `handoff` and `rerun`:

```json
{
  "projectId": "project-<saved-id>",
  "journeyId": "find-price",
  "participantCount": 1,
  "options": { "timeoutMs": 600000, "accessibilityChecks": false }
}
```

Options are recorded with the run. They never enable consequential actions or change the plan's target, profiles or task.
