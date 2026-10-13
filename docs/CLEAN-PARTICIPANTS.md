# Clean participants

[← Back to README](../README.md)

A usability test only tells you something if the participant arrives knowing nothing about the product. An AI agent running inside your project chat, or as a subagent of it, already knows a lot: the project's `CLAUDE.md` or `AGENTS.md`, its memory, every connected MCP (CMS, analytics…), and messages from other chats. That knowledge leaks into "first-visit" behaviour.

So each participant runs as **its own headless process**, for every kind of target (live site, localhost, Figma flow, native app). Your chat stays the coordinator and evaluator; it never plays the participant.

## How the runner isolates a participant

- **Claude Code:** `claude -p` from an empty temporary folder, `--setting-sources user`, `--strict-mcp-config` with only the usability MCP, and file, web, agent, skill and messaging tools disallowed. No session is saved. (`--bare` is not used because it needs an API key instead of your subscription.)
- **Codex:** `codex exec` from an empty folder with a private `CODEX_HOME` that holds only a link to your login and the usability MCP: no other servers, plugins, memories or global `AGENTS.md`. Read-only sandbox, stdin closed.
- **Preflight:** a one-line call first. If the CLI login has expired it stops with "run `claude /login`" (or `codex login`) before anything opens.
- **Canary:** the isolated participant is asked whether its instructions, memory, files or loaded context mention the product under test (terms taken from the URL, prototype or plan name, plus any `--terms`), or contain project material. Anything found stops the run and names the source. A canary is a self-report: it reduces prior knowledge but cannot prove it is absent. General knowledge of well-known brands is not checked.
- **One at a time:** a lock file (`<artifacts>/active-run.json`) refuses a second participant while one runs. Stale locks from dead processes are cleaned up.
- **Exact IDs:** the start command carries the project, journey or prototype IDs created in your chat. The runner forces one participant and a first-visit declaration, and never edits the plan.
- **No self-evaluation:** the participant submits no findings. Your chat evaluates afterwards with `usability_review_session` (one session) or `usability_combine_sessions` (several runs of the same task, which become a normal comparison round with its review stages).

Reports say that each participant ran as its own headless process and passed a product-knowledge check.

## Running it yourself

`/usability-test` does all of this for you. To run it by hand:

```bash
R="node ~/.local/share/usability-mcp/runtime/node_modules/usability-test-mcp/bin/usability-test-mcp.mjs participant --host claude"
$R --check --start '{"tool":"usability_quick_test","arguments":{"target":"https://example.com","goal":"Find the monthly price"}}'
$R --start '{"tool":"usability_quick_test","arguments":{"target":"https://example.com","goal":"Find the monthly price"}}'
```

Use `--host codex` for Codex. Each run writes `participant-run.json` with what was isolated and checked.

## When isolation is not possible

If the check finds project knowledge, `/usability-test` stops, shows what leaked and offers two choices: remove that source and retry, or run an **informed walkthrough** in the chat, labelled as such. It never claims a fresh context when isolation failed.

## Context declarations

Every run declares its context: `contextCheck: { mode: "first-visit", isolation: "host-reported fresh", exposure: [] }` (inside `options` for project runs). If the context already knows the source code, discovery screens, earlier findings or journeys, report them as `source-code`, `discovery`, `prior-findings` or `prior-journeys`. First-visit mode rejects shared or unknown isolation and any exposure. The tool checks declarations; it cannot read a model's memory.

`mode: "informed-walkthrough"` records an informed review with its real isolation and exposures. Its report withholds first-visit conclusions. Discovery-assisted runs always need a fresh context.

Browser data is always isolated per participant. Chat context is controlled by the host, and this project says so honestly in every report.
