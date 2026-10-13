# Test a Figma flow

[← Back to README](../README.md)

![Three demo frames: welcome, choose a plan, all set, with the participant's taps marked](assets/demo-figma.png)

Paste a Figma design link to a **section**, a **page** or a **whole file**:

```text
/usability-test https://www.figma.com/design/<file>/<name>?node-id=1-2 first-time owner starting on a plan
```

- **Section:** its screens are the flow.
- **Page or file:** the tool lists the sections; test one, several or all, each as its own flow.
- **Spec boards** with several rows (journeys, alternatives, error states): the tool shows the rows and you pick the screens one person would go through, in order. This costs no extra Figma call.

## Preparing the file

- Put a flow's screens in a section, left to right (more rows run top to bottom).
- To score taps, add a layer whose name starts with `@tap` over the element that should be tapped on each screen. It can be an invisible rectangle. Unmarked steps are recorded and judged afterwards.

## How it reads the file

**With the official Figma MCP (default, no token):** the chat calls `get_metadata` once and `usability_plan_figma_flow` orders the screens and reads the `@tap` layers. It then makes **one** `get_screenshot` of the whole section, and `usability_import_figma_section` crops each screen locally and scales the targets. That is two Figma calls per flow, which matters on free plans: Figma's MCP allows Starter plans and View/Collab seats about 20 calls a month, and Dev/Full seats on paid plans about 200 a day ([Figma limits](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)). The Figma MCP can only open files you can view **and** that belong to a plan you are in.

**Fallback for any plan and any file you can view (no API):** when the Figma MCP is missing, refuses the file or hits its limit, select the section in Figma → **Export → PNG** (duplicate Community files first) and give the path, or export each frame into a folder. `usability_import_figma_export` detects the screens in a section image (or proposes the folder's file order) for you to confirm. Without metadata, `@tap` targets are unknown, so steps are unscored or targets are proposed for your approval.

## During the test

Participants run isolated, as for websites ([CLEAN-PARTICIPANTS.md](CLEAN-PARTICIPANTS.md)):

- they see one frame at a time;
- a tap on the marked target shows the next frame; anywhere else is a misclick (after three, the facilitator moves on);
- `back` returns to the previous frame;
- frame names, screen counts and targets are never shown to them.

Reports name the design and add a **Prototype** line: first tap on target per screen, misclicks and move-ons.

## Limits

Static frames have no hover, loading, typing or scrolling inside a frame, and may hold placeholder content. The flow is linear (one path in section order). An AI reading images judges how clear the screens and their order are, not interaction polish. Images cannot get an automated accessibility scan.
