# Install, update and remove

[← Back to README](../README.md)

## Requirements

- **Node.js 22+**, npm and Git.
- The CLI of the chat you use: [Claude Code](https://code.claude.com/docs) or [Codex](https://developers.openai.com/codex/), logged in with your subscription.
- macOS, Linux or Windows. **Windows is experimental:** install, setup for both hosts and the generated commands are checked on a clean Windows machine, but not yet in day-to-day use.
  - Claude Code on Windows needs [Git for Windows](https://git-scm.com/downloads/win) (it runs commands in Git Bash).
  - Codex on Windows runs commands in PowerShell; `/prompts:usability-test` is generated for that.
  - Prefer WSL? Run the install command inside WSL and use the Linux instructions.
- Remote-only chat apps (ChatGPT in a browser) can't start a local MCP server.

No model API key, npm account or GitHub login is needed. The repository is public.

## One command

```bash
npx --yes github:gabrielhidalgow/usability-test-mcp setup --host claude-code,codex
```

Use `--host claude-code` or `--host codex` for only one of them. The command:

1. builds a durable local copy in `~/.local/share/usability-mcp/runtime/`;
2. installs Chromium and checks it launches;
3. registers the `usability` MCP with each host (Claude Code in **user scope**, so it works in every project; Codex through `codex mcp add`);
4. installs the `/usability-test` command (Claude Code: `~/.claude/commands/usability-test.md`; Codex: `~/.codex/prompts/usability-test.md`, run as `/prompts:usability-test`);
5. records what it installed in `install.json`.

Restart Claude Code or Codex afterwards (or reconnect with `/mcp`).

**Pinned version:** add a tag or commit, for example `github:gabrielhidalgow/usability-test-mcp#v0.14.0`.

**Other hosts:** `--host claude-desktop` (macOS and Windows) merges the server into Claude Desktop's config with a backup. `--host manual` prints the configuration for any other local MCP host. The old `--host claude` alias still means Claude Desktop.

## Keeping it up to date

`/usability-test` checks for a new version every time it starts. If there is one, it installs it and asks you to restart. You can also run it yourself:

```bash
node ~/.local/share/usability-mcp/runtime/node_modules/usability-test-mcp/bin/usability-test-mcp.mjs update
```

It prints one of `UP-TO-DATE`, `UPDATED`, `OFFLINE`, `UPDATE-FAILED` or `NOT-INSTALLED`. Updates keep your reports and saved projects. Stop running tests first.

**Your edits are safe.** If you edit an installed `/usability-test` command, updates leave it alone and write the new version next to it as `usability-test.md.new`.

## Check everything works

```bash
npx --yes github:gabrielhidalgow/usability-test-mcp doctor
```

It prints a checklist (Node, Chromium, MCP registration, slash command, clean-participant check for each host) with the fix for anything that fails. The most common fix is logging the CLI in again: `claude /login` or `codex login`. The headless CLI login is separate from the desktop app's login.

Add `--native` to check the experimental native app prerequisites (see [NATIVE.md](NATIVE.md)).

## Uninstall

```bash
npx --yes github:gabrielhidalgow/usability-test-mcp uninstall
```

This removes the MCP registrations and the generated commands (only ones you have not edited). Reports and saved projects in `~/.local/share/usability-mcp/artifacts/` stay. Delete that folder too if you want them gone.

## Where things live

| What | macOS and Linux | Windows |
| --- | --- | --- |
| Runtime | `~/.local/share/usability-mcp/runtime/` | `%LOCALAPPDATA%\usability-mcp\runtime\` |
| Reports, screenshots, saved projects | `~/.local/share/usability-mcp/artifacts/` | `%LOCALAPPDATA%\usability-mcp\artifacts\` |
| Install record | `~/.local/share/usability-mcp/install.json` | `%LOCALAPPDATA%\usability-mcp\install.json` |

Use `--dir "/absolute/path"` with `setup`, `update`, `doctor` and `uninstall` to put everything elsewhere. Registrations use absolute paths to Node and the server, so rerun setup if you move Node.

## Manual configuration

Build a clone first (`npm ci && npm run build`), then point your host at `dist/src/index.js`.

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.usability]
command = "node"
args = ["/ABSOLUTE/PATH/usability-test-mcp/dist/src/index.js"]
cwd = "/ABSOLUTE/PATH/usability-test-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

**Claude Desktop** (`claude_desktop_config.json`, merged with your other servers):

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

If the app cannot find Node, replace `node` with the output of `command -v node`. Ask the chat to call `usability_health`: it should return `reasoningMode: "connected-host-chat"` and `apiKeyRequired: false`.

Other hosts need the same command and must support image tool results and multi-step tool use. See the [official local MCP guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

**Local only:** the server runs over stdio on your computer. ChatGPT in a browser cannot start a local server; there is no hosted or HTTP version.

## Optional settings

`.env` is optional and holds local settings only:

- `USABILITY_ARTIFACT_DIR`: where reports go.
- `USABILITY_HEADLESS=true`: run browsers in the background by default.

There are no model credentials to configure.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `doctor` says the CLI is not logged in | Run `claude /login` or `codex login` in a terminal. |
| The `usability` tools do not appear | Restart the host or reconnect with `/mcp`, then check `usability_health`. |
| Chromium fails to launch on Linux | `npx playwright install --with-deps chromium` (needs admin rights). |
| Windows: `claude` can't run commands | Install Git for Windows, then restart Claude Code. |
| Windows: Codex mangles the start JSON | The command passes it as `--start @file.json`; update with `/prompts:usability-test` (it updates itself). |
| `/usability-test` is missing | Rerun setup. If you had your own file there, look for `usability-test.md.new`. |
| A test says project knowledge leaked | See [CLEAN-PARTICIPANTS.md](CLEAN-PARTICIPANTS.md). |

If you are still stuck, [open an issue](https://github.com/gabrielhidalgow/usability-test-mcp/issues/new/choose) with the `doctor` output.
