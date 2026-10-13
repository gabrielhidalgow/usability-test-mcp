# Safety and limits

[← Back to README](../README.md)

## Browser safety (web runs)

- Test sites you are allowed to test: your own, staging, or a local or disposable copy. Clicking around can change application state, even though the server never edits code.
- **Default deny.** Consequential labels, off-origin navigation, non-HTTP navigation, downloads, popups, WebSockets and unapproved write requests are guarded. Service workers are blocked. This can stop some legitimate apps from loading or finishing a task.
- **Overrides** need **both** `testEnvironment: true` and explicit `allowedCapabilities`: `formSubmission`, `accountCreation`, `communication`, `publicPosting`, `deletion`, `accountClosure`, `payment`. Use them only with fake data and sandbox services. Never enable payment against real money or communication against real people.
- These guards are defence in depth, **not a security sandbox**. Labels and HTTP methods cannot prove what a site does; even a GET can change state. Do not point this at real payment, messaging or destructive production flows.
- Same-origin links to contact or information pages can open without the communication capability. Sending messages and submitting forms stay guarded.
- Password and common payment fields are excluded or masked. Common secret patterns are redacted from text artifacts, and raw provider errors are never stored. Screenshots can still contain sensitive data: check artifacts before sharing them. Query strings are stripped from stored locations.

Native runs have their own, weaker limits: see [NATIVE.md](NATIVE.md).

## What a participant can see

Participants get the visible screenshot, visible UI text and semantics, their profile, the task and their own history. They never get source code, hidden DOM values, test IDs, network responses, discovery screens, suggested routes, success criteria or earlier findings. Product content is treated as untrusted.

The browser viewer overlay (pointer and status badge) is excluded from participant screenshots, text, layout checks and accessibility scans. It never shows typed values.

## Blocked requests and diagnostics

Reports include **browser policy diagnostics**: the reason, request method, resource type, phase and whether the block stopped the journey. They never include URLs, query strings, credentials, headers or bodies.

Blocked requests are grouped by effect:

| Group | Effect |
| --- | --- |
| **Third-party tracking** | Writes to other sites (analytics, ad pixels) are aborted, never sent. No effect on what the participant saw. |
| **Page resources** | Blocked scripts, images or frames may change what was shown. The participant is warned that the page may differ. |
| **Site writes** | Writes to the product's own site (including subdomains) after an interaction stop the run, because they may be the participant's own submission. |
| **Navigations** | Blocked main-frame navigations stop the run. |

Only the last three count as coverage gaps. Missing content caused by these restrictions must not be reported as a usability problem. Before the first interaction, blocked background writes are aborted but do not stop a readable page. The site match approximates the registrable domain; purpose is not known.

Execution failures record their stage (startup, observation, action or participant reasoning). Slow navigations are retried for observation only; a participant's action is never repeated automatically.

## Capture quality

Web captures wait briefly (about two seconds at most) for layout, fonts and finite animations to settle. Unsettled captures are flagged; recheck automated contrast findings taken during transitions.

## What this is not

- **Not real users.** Synthetic participants are AI agents. Their commentary and completion judgments are model output, labelled as simulated, and must not be presented as human research.
- **No usability score.** There is no overall score or statistical significance.
- **Not a WCAG audit.** axe checks and keyboard journeys find some issues; they do not certify conformance. Keyboard mode does not certify focus visibility, order, traps, announcements, zoom or reduced motion.
- **Out of scope:** cross-origin frames, canvas-only controls, native dialogs, choosing select options, file upload, login, multi-tab journeys, PDFs and downloads, and full screen-reader behaviour.

## Data and privacy

Everything runs on your computer. Screenshots and UI text are sent to your connected chat (Claude Code or Codex) for reasoning, under that host's data policies, so only test what you are allowed to share there. The server never sends source code or response bodies, never logs in to a model provider and never calls a model API.

Reports live in `~/.local/share/usability-mcp/artifacts/` (or `.usability/` in a clone, which is ignored by Git).
