---
workflow: motion-graphics
flow: automation
storyboard: no
message: "A synthetic participant really clicks through your product"
destination: GitHub README (autoplaying silent loop)
aspect: "16:9"
length: 8s
audio: none
---

## Intent
Cursor close-up loop for the Usability Test MCP README. Real stills of the built-in demo product
(Little Ledger) from `npm run readme-assets`, a drawn cursor gliding and clicking "Options", then
"Try this plan", with zoom punch-ins, ending on the setup page with "Task completed". Seamless loop.

## Notes
- Labelled "Demo product" on screen; never presented as research.
- Cursor targets come from `assets/targets.json` (measured from the real page, 1280×720 viewport).
- After rendering: ffmpeg → `docs/assets/cursor-loop.webp` (960 px, ~15 fps). MP4 goes on the GitHub release.
