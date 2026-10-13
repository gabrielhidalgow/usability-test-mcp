# Native apps (experimental)

[← Back to README](../README.md)

`usability_run_native` is an experimental, screenshot-driven adapter for **local Maestro**. It does not use Maestro Cloud or model APIs.

## Before you start

You set these up yourself; the MCP setup does not install them:

- [Maestro and its prerequisites](https://docs.maestro.dev/get-started/installing-maestro) (including Java);
- a disposable Android emulator or iOS simulator, booted;
- a sandbox build of your app installed on it, with fake data.

Check with:

```bash
npx --yes github:gabrielhidalgow/usability-test-mcp doctor --native
```

## Running a test

Give `/usability-test` the app or bundle ID (for example `com.example.app`) and a goal. The chat asks for the device ID, operating system and audience, and asks you to confirm the device is prepared for testing (`preparedTestDevice: true`).

The participant gets a screenshot and chooses `tap_point` (normalised coordinates plus the visible control label) or `enter_text` after focusing a non-sensitive field. Scroll and Android back are supported; on iOS it uses the visible back control. No source code, hidden hierarchy IDs or predetermined flow is given to the participant.

**Guided setup for an app:** use `scan` (or `usability_discover_product`) with `platform: "native"`, `appId`, `deviceId`, `os`, `preparedTestDevice: true` and `currentAppConfirmed: true`. The app must already be on screen. Discovery captures that screen only: no launch, navigation or data reset. Before testing, confirm the starting screen with `handoff.startingStateConfirmed: true` (or `options.startingStateConfirmed` for a manual plan). App identity and starting state are confirmed by the host, not verified independently.

## Limits

- Tested with a labelled command-runner fixture, not a real device. Treat it as experimental until your own device smoke test passes.
- No network interception, independent checking of tap labels, screenshot masking, app-data isolation or reset, or native accessibility audit.
- Permissions are denied at launch, so features that need them may be unavailable.
- The adapter does not stop or clear the app at the end.
- One participant per run; native rounds and continuation are not supported. Focus areas take a name and description only.
- Do not use personal devices or production accounts.

See [Maestro commands](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options).
