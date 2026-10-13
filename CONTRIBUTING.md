# Contributing

Thanks for helping. Bug reports, Figma or site cases that break, and small focused pull requests are all welcome.

## Set up

```bash
git clone https://github.com/gabrielhidalgow/usability-test-mcp.git
cd usability-test-mcp
npm ci
npx playwright install chromium
npm run check
```

`npm run check` runs the type check, the unit and integration tests (against a local fixture site with a labelled test participant), the build and the installer tests. It must pass before a PR.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run demo` | Runs three participants against the fixture with the deterministic test double and prints the report paths |
| `npm run fixture` | Serves the fixture site on `http://127.0.0.1:4173` |
| `npm run readme-assets` | Regenerates the README images in `docs/assets/` |
| `node bin/usability-test-mcp.mjs setup --host claude-code --dir /tmp/um` | Installs your working copy into a throwaway folder |

## Rules that keep the tests honest

These come from [AGENTS.md](AGENTS.md):

- **No model API keys or direct model calls.** Reasoning comes from the connected chat (Claude Code, Codex or another MCP host) through ordinary tool calls.
- **Participants see only visible UI**, their profile, the task and their own history. Never source code, hidden DOM values, test IDs, network responses or an expected route.
- **Default-deny consequential actions.** Overrides need `testEnvironment` plus a per-capability opt-in.
- **Label synthetic evidence.** No usability score, no WCAG compliance claims. Keep observations, interpretations and recommendations separate and linked to evidence.
- **Keep the core independent of Playwright.** Driver-specific code lives under `src/drivers/`.
- **Never log API keys or raw provider errors.** Artifacts may contain product data and stay ignored by Git.

Behaviour changes should start from the [build brief](docs/design/BUILD_BRIEF.md) and the [methodology](docs/METHODOLOGY.md).

## Pull requests

- Keep each PR to one change, with a test.
- Use plain words in user-facing text.
- Describe what you checked by hand (for example a real site or Figma file), without sharing private data.
