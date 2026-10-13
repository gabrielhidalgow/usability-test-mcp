// Regenerates the README images from the built-in demo product (npm run readme-assets).
// Uses the deterministic test participant, so images are labelled as a demo, never as research.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { EvidenceRecorder } from '../src/evidence/recorder.js';
import { SessionOrchestrator } from '../src/core/session-orchestrator.js';
import { PlaywrightProductDriver } from '../src/drivers/playwright/driver.js';
import { installObserver, showStatus } from '../src/drivers/playwright/observer.js';
import { FixtureProvider } from '../tests/fixtures/provider.js';
import { startFixture } from '../tests/fixtures/site.js';

const out = resolve('docs/assets');
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const AMBER = '#ffb000';

function banner(dark: boolean) {
  const bg = dark ? '#0d1117' : '#ffffff', fg = dark ? '#f0f6fc' : '#1f2328', sub = dark ? '#9198a1' : '#59636e', tile = dark ? '#161b22' : '#f6f8fa';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="280" viewBox="0 0 1280 280" role="img" aria-label="Usability Test MCP">
  <rect width="1280" height="280" fill="${bg}"/>
  <g transform="translate(96 70)">
    <rect width="140" height="140" rx="32" fill="${tile}" stroke="${dark ? '#30363d' : '#d1d9e0'}"/>
    <rect x="28" y="34" width="84" height="60" rx="8" fill="none" stroke="${fg}" stroke-width="6"/>
    <line x1="28" y1="50" x2="112" y2="50" stroke="${fg}" stroke-width="6"/>
    <circle cx="92" cy="92" r="20" fill="${AMBER}33" stroke="${AMBER}" stroke-width="6"/>
    <path d="M84 84 L84 118 L93 109 L100 124 L107 121 L100 106 L112 106 Z" fill="${fg}" stroke="${bg}" stroke-width="3" stroke-linejoin="round"/>
  </g>
  <text x="280" y="138" font-family="${FONT}" font-size="58" font-weight="700" fill="${fg}">Usability Test MCP</text>
  <text x="282" y="190" font-family="${FONT}" font-size="26" fill="${sub}">Usability tests for websites, localhost and Figma flows, from Claude Code and Codex</text>
</svg>\n`;
}

async function shot(page: Page, html: string, path: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path });
}
const dataUrl = async (path: string) => `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
const card = (inner: string, extra = '') => `<div style="background:#fff;border:1px solid #d1d9e0;border-radius:14px;box-shadow:0 18px 50px #1f232822;overflow:hidden;${extra}">${inner}</div>`;
const windowBar = (title: string) => `<div style="height:38px;background:#f6f8fa;border-bottom:1px solid #d1d9e0;display:flex;align-items:center;gap:8px;padding:0 14px;font:13px ${FONT};color:#59636e"><span style="width:12px;height:12px;border-radius:6px;background:#ff5f57"></span><span style="width:12px;height:12px;border-radius:6px;background:#febc2e"></span><span style="width:12px;height:12px;border-radius:6px;background:#28c840"></span><span style="margin-left:12px">${title}</span></div>`;
const label = (text: string) => `<div style="font:600 15px ${FONT};color:#59636e;letter-spacing:.02em;text-transform:uppercase;margin:0 0 12px 4px">${text}</div>`;

async function main() {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'banner-light.svg'), banner(false));
  await writeFile(join(out, 'banner-dark.svg'), banner(true));
  const work = await mkdtemp(join(tmpdir(), 'readme-assets-'));
  const site = await startFixture();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    // 1. Live browser with the viewer overlay (pointer and status), as people see it during a run.
    await page.setViewportSize({ width: 960, height: 600 });
    await installObserver(page);
    await page.goto(site.url);
    const box = (await page.getByRole('link', { name: 'Options' }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await showStatus(page, { participant: 'First-time small business owner', step: 2, phase: 'executing', action: 'click "Options"' });
    await page.screenshot({ path: join(work, 'browser.png') });
    // 2. A real report from the demo product, run by the deterministic test participant.
    const recorder = new EvidenceRecorder(join(work, 'artifacts'));
    const run = await new SessionOrchestrator(recorder, () => new PlaywrightProductDriver(true)).run({
      target: site.url, persona: { name: 'First-time small business owner', context: 'Runs a small business and is comparing accounting tools' },
      scenario: 'You are looking for simple accounting software for your business.', goal: 'Find the monthly price and start setting up a workspace.', accessibilityChecks: false,
    }, new FixtureProvider());
    // The fixture listens on a random port; show the product name instead.
    const markdown = (await readFile(run.paths.report, 'utf8')).replace(new RegExp(`${site.url.replace(/\/$/, '')}/?`, 'g'), 'Little Ledger (demo product)');
    const rendered = spawnSync('gh', ['api', 'markdown', '-f', `text=${markdown}`, '-f', 'mode=gfm'], { encoding: 'utf8' });
    if (rendered.status !== 0) throw new Error('Rendering the report needs the GitHub CLI (gh) to be logged in.');
    const reportHtml = `<div style="padding:26px 30px;font:15px/1.55 ${FONT};color:#1f2328" class="md">${rendered.stdout.replace(/<a href="[^"]*\.png"[^>]*>Screenshot<\/a>/g, '<u>Screenshot</u>')}</div>
      <style>.md h1{font-size:24px;margin:0 0 12px}.md h2{font-size:18px;border-bottom:1px solid #d1d9e0;padding-bottom:6px;margin:22px 0 10px}.md h3{font-size:16px;margin:16px 0 6px}.md table{border-collapse:collapse;font-size:13px}.md td,.md th{border:1px solid #d1d9e0;padding:5px 8px}.md p,.md li{margin:6px 0}.md a,.md u{color:#0969da;text-decoration:none}</style>`;
    // 3. Hero: browser and report side by side.
    await shot(page, `<body style="margin:0;background:linear-gradient(135deg,#f6f8fa,#eef2ff);padding:44px 48px;font-family:${FONT}">
      <div style="display:flex;gap:40px;align-items:flex-start">
        <div style="flex:0 0 760px">${label('1 · A synthetic participant uses your product')}${card(`${windowBar('Little Ledger (demo product)')}<img src="${await dataUrl(join(work, 'browser.png'))}" style="display:block;width:760px">`)}</div>
        <div style="flex:1">${label('2 · You get a short, evidence-backed report')}${card(`<div style="height:700px;overflow:hidden;position:relative">${reportHtml}<div style="position:absolute;inset:auto 0 0 0;height:120px;background:linear-gradient(transparent,#fff)"></div></div>`)}</div>
      </div>
      <div style="margin-top:18px;font:13px ${FONT};color:#59636e">Demo product and deterministic test participant, shown for illustration. Not real research.</div></body>`, join(out, 'demo.png'), { width: 1600, height: 840 });
    // 4. Report on its own.
    await shot(page, `<body style="margin:0;background:#f6f8fa;padding:32px">${card(reportHtml, 'max-width:860px')}</body>`, join(out, 'demo-report.png'), { width: 924, height: 1180 });
    // 5. Figma flow: drawn demo frames in order, with the tap that moves on.
    const phone = (body: string, tap = false) => `<div style="position:relative">${card(`<div style="width:300px;height:560px;display:flex;flex-direction:column;padding:28px 24px;box-sizing:border-box;font-family:${FONT};color:#1f2328">
      <div style="font:700 15px ${FONT};color:#0f766e;margin-bottom:28px">◆ Little Ledger</div>${body}</div>`, 'border-radius:28px')}${tap ? `<div style="position:absolute;left:131px;bottom:33px;width:30px;height:30px;border:4px solid ${AMBER};background:${AMBER}44;border-radius:50%"></div>` : ''}</div>`;
    const button = (text: string) => `<div style="margin-top:auto;background:#0f766e;color:#fff;border-radius:12px;padding:14px;text-align:center;font:600 16px ${FONT}">${text}</div>`;
    const plan = (name: string, price: string, on = false) => `<div style="border:2px solid ${on ? '#0f766e' : '#d1d9e0'};border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between"><b>${name}</b><span>${price}/mo</span></div>`;
    const arrow = `<div style="font:700 34px ${FONT};color:#8c959f;align-self:center">→</div>`;
    const frames = [
      phone(`<div style="font:700 28px/1.2 ${FONT}">Accounting that takes minutes, not weekends</div><div style="margin-top:14px;color:#59636e;font-size:16px">Invoices, expenses and tax in one place.</div>${button('Get started')}`, true),
      phone(`<div style="font:700 26px ${FONT};margin-bottom:18px">Choose a plan</div>${plan('Starter', '$12', true)}${plan('Growth', '$29')}${plan('Team', '$59')}${button('Continue')}`, true),
      phone(`<div style="font:700 26px ${FONT}">You are all set</div><div style="margin-top:14px;color:#59636e;font-size:16px">Your workspace is ready. Add your first invoice.</div>${button('Open workspace')}`),
    ];
    await shot(page, `<body style="margin:0;background:#f6f8fa;padding:36px 44px;font-family:${FONT}">${label('Figma flow · one frame at a time · each tap checked against the @tap target')}
      <div style="display:flex;gap:26px">${frames.join(arrow)}</div>
      <div style="margin-top:18px;font:13px ${FONT};color:#59636e">Demo frames for illustration. The amber ring marks where the participant tapped.</div></body>`, join(out, 'demo-figma.png'), { width: 1180, height: 690 });
    // 6. Social preview (upload in GitHub: Settings → Social preview).
    await shot(page, `<body style="margin:0;width:1280px;height:640px;background:#0d1117;font-family:${FONT};overflow:hidden">
      <img src="data:image/svg+xml;base64,${Buffer.from(banner(true)).toString('base64')}" style="display:block;width:1280px">
      <div style="display:flex;gap:40px;padding:0 96px"><img src="${await dataUrl(join(work, 'browser.png'))}" style="width:500px;border-radius:12px;border:1px solid #30363d">
      <div style="color:#f0f6fc;font:600 30px/1.35 ${FONT};align-self:center">Synthetic participants.<br>Real browser.<br>Evidence-backed reports.<div style="font:400 20px ${FONT};color:#9198a1;margin-top:14px">No API keys: runs on your Claude or ChatGPT subscription.</div></div></div></body>`, join(out, 'social-preview.png'), { width: 1280, height: 640 });
    console.log(`README assets written to ${out}`);
  } finally { await browser.close(); await site.close(); await rm(work, { recursive: true, force: true }); }
}
await main();
