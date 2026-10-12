import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// A synthetic "section": three 400×300 screens on a grey background, two rows, standing in for a Figma section render.
export const SECTION_XML = `<section id="10:1" name="Onboarding" x="0" y="0" width="920" height="720">
  <frame id="10:3" name="Plan" x="480" y="40" width="400" height="300" />
  <frame id="10:2" name="Welcome" x="40" y="40" width="400" height="300">
    <group id="10:5" name="cta" x="140" y="190" width="120" height="60">
      <rectangle id="10:6" name="@tap Get started" x="10" y="10" width="100" height="40" hidden="true" />
    </group>
  </frame>
  <frame id="10:4" name="Done" x="40" y="380" width="400" height="300" />
</section>`;
const screen = (left: number, top: number, html: string) => `<div style="position:absolute;left:${left}px;top:${top}px;width:400px;height:300px;background:#fff;font:16px sans-serif">${html}</div>`;
export async function renderSection(scale = 1, titleStrip = 0) {
  const dir = await mkdtemp(join(tmpdir(), 'figma-section-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 920, height: 720 + titleStrip }, deviceScaleFactor: scale });
    // Figma's section render puts the section title in a strip above the content.
    await page.setContent(`<body style="margin:0;background:#d9d9d9"><div style="height:${titleStrip}px;background:#fff;font:12px sans-serif">Onboarding</div><div style="position:relative">${screen(40, 40, '<h1>Welcome to Ledger</h1><button style="position:absolute;left:150px;top:200px;width:100px;height:40px">Get started</button>')}${screen(480, 40, '<h1>Choose a plan</h1><button style="position:absolute;left:150px;top:200px;width:100px;height:40px">Continue</button>')}${screen(40, 380, '<h1>You are all set</h1>')}</div></body>`);
    const path = join(dir, `section@${scale}x-${titleStrip}.png`);
    await page.screenshot({ path });
    return { dir, path };
  } finally { await browser.close(); }
}
