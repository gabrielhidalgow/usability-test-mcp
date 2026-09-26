import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Three 400×300 static "frames" rendered to PNG, standing in for exported Figma frames.
const screens = [
  { id: 'welcome', name: 'SECRET-FRAME-NAME-01 Welcome', html: '<h1>Welcome to Ledger</h1><button style="position:absolute;left:150px;top:200px;width:100px;height:40px">Get started</button>' },
  { id: 'plan', name: 'SECRET-FRAME-NAME-02 Plan', html: '<h1>Choose a plan</h1><p>Starter $12 per month</p><button style="position:absolute;left:150px;top:200px;width:100px;height:40px">Continue</button>' },
  { id: 'done', name: 'SECRET-FRAME-NAME-03 Done', html: '<h1>You are all set</h1>' },
];
export async function renderPrototypeFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'prototype-fixture-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    for (const s of screens) { await page.setContent(`<body style="margin:0;font:16px sans-serif">${s.html}</body>`); await page.screenshot({ path: join(dir, `${s.id}.png`) }); }
  } finally { await browser.close(); }
  const manifest = {
    name: 'Ledger onboarding', source: { tool: 'test-fixture' }, device: 'desktop' as const,
    screens: screens.map(s => ({ id: s.id, name: s.name, image: { path: join(dir, `${s.id}.png`) }, visibleText: s.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })),
    // The Get started button box, in frame pixels. The plan screen is left unscored.
    targets: [{ screenId: 'welcome', x: 150, y: 200, width: 100, height: 40, label: 'Get started', basis: 'owner-marked' as const }],
  };
  return { dir, manifest };
}
