// Regenerates the README images and the video stills from the built-in demo product (npm run readme-assets).
// Uses the deterministic test participant, so images are labelled as a demo, never as research.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { EvidenceRecorder } from '../src/evidence/recorder.js';
import { SessionOrchestrator } from '../src/core/session-orchestrator.js';
import { PlaywrightProductDriver } from '../src/drivers/playwright/driver.js';
import { FixtureProvider } from '../tests/fixtures/provider.js';
import { startDemoSite } from './demo-site.js';

const out = resolve('docs/assets');
const videoAssets = resolve('video/assets');
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const BLUE = '#2563eb', BLUE_DARK = '#4c8dff', INK = '#1f2328', PAPER = '#f0f6fc';
const PERSONA = 'First-time small business owner';

// Logo: two screens joined by a dotted path, ending at a cursor (refined from a QuiverAI Arrow 2 draft).
const CURSOR = 'm63.36 23.43-11.42-6.54c-0.93-0.54-2.01 0.29-1.71 1.35l3.09 11.88c0.3 1.07 1.65 1.27 2.26 0.36l1.19-1.89c0.06-0.11 0.2-0.11 0.27 0l2.31 3.62c0.45 0.7 1.37 0.91 2.09 0.51l0.37-0.21c0.78-0.45 1.02-1.45 0.54-2.21l-2.33-3.71c-0.08-0.11-0.02-0.25 0.11-0.28l2.91-0.58c1.15-0.35 1.32-1.78 0.32-2.3z';
function markShapes(ink: string, accent: string) {
  const dot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="1.9" fill="${accent}"/>`;
  return `<rect x="9" y="52" width="14" height="14" rx="3.5" fill="${accent}"/>${dot(27.5, 54.5)}${dot(32, 51)}${dot(36.5, 47.5)}
  <rect x="38" y="32" width="14" height="14" rx="3.5" fill="${accent}"/>${dot(55, 33)}
  <path transform="translate(47 4) scale(1.75) translate(-50.2 -16.7)" d="${CURSOR}" fill="${ink}"/>`;
}
export const logo = (dark = false, size = 80) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 80 80" role="img" aria-label="Usability Test MCP logo">
  ${markShapes(dark ? PAPER : INK, dark ? BLUE_DARK : BLUE)}
</svg>\n`;
const svgUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

function banner(dark: boolean) {
  const bg = dark ? '#0d1117' : '#ffffff', fg = dark ? PAPER : INK, sub = dark ? '#9198a1' : '#59636e', accent = dark ? BLUE_DARK : BLUE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="260" viewBox="0 0 1280 260" role="img" aria-label="Usability Test MCP">
  <rect width="1280" height="260" fill="${bg}"/>
  <g transform="translate(92 50) scale(2)">${markShapes(fg, accent)}</g>
  <text x="290" y="128" font-family="${FONT}" font-size="60" font-weight="700" letter-spacing="-1.2" fill="${fg}">Usability Test <tspan fill="${accent}">MCP</tspan></text>
  <text x="292" y="178" font-family="${FONT}" font-size="25" fill="${sub}">Usability tests for websites, localhost and Figma flows, from Claude Code and Codex</text>
</svg>\n`;
}

async function shot(page: Page, html: string, path: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path });
}
const dataUrl = async (path: string) => `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
const card = (inner: string, extra = '') => `<div style="background:#fff;border:1px solid #d8dee4;border-radius:16px;box-shadow:0 0 0 1px #ffffff14,0 24px 60px #00000080;overflow:hidden;${extra}">${inner}</div>`;
const windowBar = (title: string) => `<div style="height:40px;background:#f6f8fa;border-bottom:1px solid #d8dee4;display:flex;align-items:center;gap:8px;padding:0 16px;font:13px ${FONT};color:#59636e">${['#ff5f57', '#febc2e', '#28c840'].map(c => `<span style="width:12px;height:12px;border-radius:6px;background:${c}"></span>`).join('')}<span style="margin:0 auto;background:#fff;border:1px solid #d8dee4;border-radius:8px;padding:3px 40px">${title}</span><span style="width:52px"></span></div>`;
const label = (n: string, text: string) => `<div style="display:flex;align-items:center;gap:10px;font:600 15px ${FONT};color:#e6edf3;margin:0 0 14px 2px"><span style="width:24px;height:24px;border-radius:12px;background:${BLUE};color:#fff;display:grid;place-items:center;font-size:13px">${n}</span>${text}</div>`;
const backdrop = 'background:#0d1117';

async function center(page: Page, name: string) {
  const box = (await page.getByRole('link', { name, exact: true }).first().boundingBox())!;
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), width: Math.round(box.width), height: Math.round(box.height) };
}

async function main() {
  await mkdir(out, { recursive: true }); await mkdir(videoAssets, { recursive: true });
  await writeFile(join(out, 'logo.svg'), logo());
  await writeFile(join(out, 'logo-dark.svg'), logo(true));
  await writeFile(join(out, 'banner-light.svg'), banner(false));
  await writeFile(join(out, 'banner-dark.svg'), banner(true));
  const work = await mkdtemp(join(tmpdir(), 'readme-assets-'));
  const site = await startDemoSite();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 720 } });
    const stills = await browser.newPage({ deviceScaleFactor: 3, viewport: { width: 1280, height: 720 } });
    // 1. Clean stills and cursor targets for the video (the composition draws its own cursor and callouts).
    const targets: Record<string, { x: number; y: number; width: number; height: number }> = {};
    await stills.goto(site.url); await stills.screenshot({ path: join(videoAssets, 'home.png') }); targets.options = await center(stills, 'Options');
    await stills.goto(`${site.url}/plans`); await stills.screenshot({ path: join(videoAssets, 'plans.png') }); targets.tryPlan = await center(stills, 'Try this plan');
    await stills.goto(`${site.url}/start`); await stills.screenshot({ path: join(videoAssets, 'start.png') });
    await writeFile(join(videoAssets, 'targets.json'), JSON.stringify({ viewport: { width: 1280, height: 720 }, ...targets }, null, 2) + '\n');
    // 2. The browser as people watch it: the participant's pointer ring (same look as the live viewer overlay), without the status badge.
    const live = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 720 } });
    await live.goto(site.url);
    await live.evaluate(([x, y]) => {
      const ring = document.createElement('div');
      ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:24px;height:24px;border:3px solid #ffb000;background:#ffb00033;border-radius:50%;transform:translate(-50%,-50%);box-sizing:border-box`;
      document.body.append(ring);
    }, [targets.options!.x, targets.options!.y]);
    await live.screenshot({ path: join(work, 'browser.png') });
    // 3. A real report from the demo product, run by the deterministic test participant.
    const recorder = new EvidenceRecorder(join(work, 'artifacts'));
    const run = await new SessionOrchestrator(recorder, () => new PlaywrightProductDriver(true)).run({
      target: site.url, persona: { name: PERSONA, context: 'Runs a small business and is comparing accounting tools' },
      scenario: 'You are looking for simple accounting software for your business.', goal: 'Find the monthly price and start setting up a workspace.', accessibilityChecks: false,
    }, new FixtureProvider());
    // The demo site listens on a random port; show the product name instead.
    const markdown = (await readFile(run.paths.report, 'utf8')).replace(new RegExp(`${site.url.replace(/\/$/, '')}/?`, 'g'), 'Little Ledger (demo product)');
    const rendered = spawnSync('gh', ['api', 'markdown', '-f', `text=${markdown}`, '-f', 'mode=gfm'], { encoding: 'utf8' });
    if (rendered.status !== 0) throw new Error('Rendering the report needs the GitHub CLI (gh) to be logged in.');
    const reportHtml = `<div style="padding:28px 32px;font:15px/1.55 ${FONT};color:${INK}" class="md">${rendered.stdout.replace(/<a href="[^"]*\.png"[^>]*>Screenshot<\/a>/g, '<u>Screenshot</u>')}</div>
      <style>.md h1{font-size:24px;letter-spacing:-.01em;margin:0 0 14px}.md h2{font-size:17px;border-bottom:1px solid #d8dee4;padding-bottom:6px;margin:24px 0 10px}.md h3{font-size:15px;margin:16px 0 6px}.md table{border-collapse:collapse;font-size:13px}.md td,.md th{border:1px solid #d8dee4;padding:5px 9px}.md th{background:#f6f8fa}.md p,.md li{margin:6px 0}.md a,.md u{color:${BLUE};text-decoration:none}</style>`;
    const browserShot = await dataUrl(join(work, 'browser.png'));
    // 4. Hero: browser and report side by side.
    await shot(page, `<body style="margin:0;${backdrop};padding:44px 52px;font-family:${FONT}">
      <div style="display:flex;gap:36px;align-items:flex-start">
        <div style="flex:0 0 880px">${label('1', 'A synthetic participant uses your product')}${card(`${windowBar('littleledger.test')}<img src="${browserShot}" style="display:block;width:880px">`)}</div>
        <div style="flex:1">${label('2', 'You get a short, evidence-backed report')}${card(`<div style="height:535px;overflow:hidden;position:relative">${reportHtml}<div style="position:absolute;inset:auto 0 0 0;height:110px;background:linear-gradient(transparent,#fff)"></div></div>`)}</div>
      </div></body>`, join(out, 'demo.png'), { width: 1600, height: 676 });
    // 5. Report on its own.
    await shot(page, `<body style="margin:0;${backdrop};padding:32px">${card(reportHtml, 'max-width:860px')}</body>`, join(out, 'demo-report.png'), { width: 924, height: 1180 });
    // 6. Figma flow: drawn demo frames in order, with the tap that moves on.
    const phone = (body: string, tap = false) => `<div style="position:relative">${card(`<div style="width:300px;height:560px;box-sizing:border-box;display:flex;flex-direction:column;padding:28px 24px;font-family:${FONT};color:#14212b">
      <div style="display:flex;align-items:center;gap:8px;font:750 16px ${FONT};margin-bottom:28px"><span style="width:24px;height:24px;border-radius:50%;background:#1d4ed8;color:#fff;display:grid;place-items:center;font-size:12px;line-height:1;padding-left:1px">L</span>Little Ledger</div>${body}</div>`, 'border-radius:30px')}${tap ? `<div style="position:absolute;left:135px;bottom:39px;width:30px;height:30px;box-sizing:border-box;border:3px solid #fff;background:#ffffff40;border-radius:50%;box-shadow:0 0 0 4px ${BLUE}80,0 4px 12px #0003"></div>` : ''}</div>`;
    const button = (text: string) => `<div style="margin-top:auto;background:#1d4ed8;color:#fff;border-radius:12px;padding:14px;text-align:center;font:600 16px ${FONT}">${text}</div>`;
    const plan = (name: string, price: string, on = false) => `<div style="border:${on ? 2 : 1}px solid ${on ? '#1d4ed8' : '#d8dee4'};border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between"><b>${name}</b><span>${price}/mo</span></div>`;
    const arrow = `<div style="align-self:center;color:#8c959f"><svg width="34" height="20" viewBox="0 0 34 20"><path d="M2 10h28M22 2l8 8-8 8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
    const frames = [
      phone(`<div style="font:750 28px/1.15 ${FONT};letter-spacing:-.02em">Accounting that takes minutes, not weekends</div><div style="margin-top:14px;color:#4b5b63;font-size:16px">Invoices, expenses and tax in one place.</div>${button('Get started')}`, true),
      phone(`<div style="font:750 26px ${FONT};letter-spacing:-.02em;margin-bottom:18px">Choose a plan</div>${plan('Starter', '$12', true)}${plan('Growth', '$29')}${plan('Team', '$59')}${button('Continue')}`, true),
      phone(`<div style="font:750 26px ${FONT};letter-spacing:-.02em">You are all set</div><div style="margin-top:14px;color:#4b5b63;font-size:16px">Your workspace is ready. Add your first invoice.</div>${button('Open workspace')}`),
    ];
    await shot(page, `<body style="margin:0;${backdrop};padding:36px 44px;font-family:${FONT}">${label('✓', 'Figma flow: one frame at a time, each tap checked against the @tap target')}
      <div style="display:flex;gap:26px">${frames.join(arrow)}</div></body>`, join(out, 'demo-figma.png'), { width: 1180, height: 668 });
    // 7. Social preview (upload in GitHub: Settings → Social preview).
    await shot(page, `<body style="margin:0;width:1280px;height:640px;background:radial-gradient(900px 500px at 0% 0%,#16264a 0%,transparent 60%),#0d1117;font-family:${FONT};overflow:hidden;position:relative">
      <div style="display:flex;align-items:center;gap:22px;padding:56px 72px 0"><img src="${svgUrl(logo(true, 96))}" width="96" height="96">
        <div><div style="font:700 54px ${FONT};letter-spacing:-.02em;color:${PAPER}">Usability Test <span style="color:${BLUE_DARK}">MCP</span></div>
        <div style="font:400 23px ${FONT};color:#9198a1;margin-top:6px">Usability tests for websites, localhost and Figma flows</div></div></div>
      <div style="position:absolute;left:72px;bottom:64px;color:${PAPER};font:600 30px/1.4 ${FONT}">Synthetic participants.<br>Real browser.<br>Evidence-backed reports.<div style="font:400 19px ${FONT};color:#9198a1;margin-top:14px">From Claude Code or Codex. No API keys.</div></div>
      <img src="${browserShot}" style="position:absolute;right:-90px;bottom:28px;width:720px;border-radius:14px;border:1px solid #30363d;box-shadow:0 30px 80px #0008"></body>`, join(out, 'social-preview.png'), { width: 1280, height: 640 });
    console.log(`README assets written to ${out}; video stills to ${videoAssets}`);
  } finally { await browser.close(); await site.close(); await rm(work, { recursive: true, force: true }); }
}
await main();
