# Usability MCP engineering rules

- User requirement: use the connected ChatGPT/Codex, Claude, or other MCP chat subscription for reasoning. Do not add provider API keys, direct model API calls, or separate API billing. This supersedes the original brief's provider examples.
- Use ordinary MCP observation/action tools. Do not require MCP sampling support or promise that every chat product supports local stdio.
- Browser isolation is enforced locally; model-context isolation is controlled by the host and must be disclosed honestly.

- Read the build brief before changing product behavior.
- Participants receive visible UI evidence, their persona, scenario, goal, and their own history only.
- Never use source code, hidden DOM values, test IDs, network responses, or an expected route to guide participants.
- Keep the core independent of Playwright. Provider-specific code belongs under reasoning/.
- Label simulated commentary and synthetic evidence; do not add a usability score or claim WCAG compliance.
- Keep observations, interpretations, and recommendations separate and evidence-linked.
- Default-deny consequential actions. Test overrides require testEnvironment and per-capability opt-in.
- Never log API keys or raw provider errors. Artifacts may contain product data; keep them ignored.
- Run npm run check for implementation changes. Integration tests use a local disposable fixture and a clearly labeled test provider.
- Do not add dashboards, cloud infrastructure, accounts, billing, or CI/CD to this MVP.
