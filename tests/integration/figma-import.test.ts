import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../src/mcp/server.js';
import { makeDecision } from '../fixtures/provider.js';
import { SECTION_XML, renderSection } from '../fixtures/figma-section.js';
import { renderPrototypeFixture } from '../fixtures/prototype.js';
import { pngSize } from '../../src/prototypes/store.js';

const LINK = 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Onboarding?node-id=10-1';
test('a plain Figma link becomes a testable flow from one section render, with export fallbacks', async () => {
  const one = await renderSection(1), two = await renderSection(2), titled = await renderSection(1, 25);
  const root = await mkdtemp(join(tmpdir(), 'figma-import-'));
  const server = createServer({ artifactRoot: root, headless: true }); const client = new Client({ name: 'figma-test-double', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>, error = false) => {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(Boolean(r.isError), error, JSON.stringify(r.content).slice(0, 400));
    const text = (r.content as { type: string; text: string }[]).find(c => c.type === 'text')!.text;
    try { return JSON.parse(text); } catch { return { error: text }; }
  };
  try {
    const board = await call('usability_plan_figma_flow', { figmaUrl: LINK, metadataXml: SECTION_XML });
    assert.equal(board.needsChoice, true); assert.match(board.nextSteps, /screens form the path/);
    const plan = await call('usability_plan_figma_flow', { figmaUrl: LINK, metadataXml: SECTION_XML, screenIds: ['10:2', '10:3', '10:4'] });
    assert.match(plan.nextSteps, /ONE Figma call: get_screenshot\(fileKey, nodeId=sectionId/);
    const flow = plan.flows[0];
    // 1x and 2x renders both crop to the right screens and keep the target on the button.
    for (const [render, scale] of [[one, 1], [two, 2]] as const) {
      const imported = await call('usability_import_figma_section', { flow, image: { path: render.path } });
      assert.deepEqual(imported.prototype.screens.map((s: { name: string; size: string }) => [s.name, s.size]), [['Welcome', `${400 * scale}×${300 * scale}`], ['Plan', `${400 * scale}×${300 * scale}`], ['Done', `${400 * scale}×${300 * scale}`]]);
      assert.equal(imported.prototype.screens[0].target, 'owner-marked: Get started');
      const stored = JSON.parse(await readFile(join(root, 'prototypes', imported.prototype.prototypeId, 'prototype.json'), 'utf8'));
      assert.deepEqual([stored.targets[0].x, stored.targets[0].y], [150 * scale, 200 * scale]);
    }
    // A render with Figma's title strip on top still crops exactly to each screen (no labels above it).
    const withTitle = await call('usability_import_figma_section', { flow, image: { path: titled.path } });
    const first = await readFile(join(root, 'prototypes', withTitle.prototype.prototypeId, 'screens', '001.png'));
    const exact = await readFile(join(root, 'prototypes', (await call('usability_import_figma_section', { flow, image: { path: one.path } })).prototype.prototypeId, 'screens', '001.png'));
    assert(first.equals(exact), 'title strip offset applied');
    const { prototypeId } = (await call('usability_import_figma_section', { flow, image: { path: one.path } })).prototype;
    let state = await call('usability_test_prototype', { prototypeId, goal: 'Get started on a plan', contextCheck: { mode: 'first-visit', isolation: 'host-reported fresh', exposure: [] } });
    const tap = makeDecision({ type: 'tap_point', x: 0.5, y: 0.733, visibleLabel: 'Get started', capability: null }); tap.contextIsolation = 'host-reported fresh';
    state = await call('usability_advance_session', { runId: state.runId, requestId: state.requestId, decision: tap });
    assert.match(state.participant.history[0].result.message, /next screen is shown/, 'the cropped target lines up with the button');
    await call('usability_cancel_session', { runId: state.runId });
    // Too small to read: the section render is under half size.
    assert.match((await call('usability_import_figma_section', { flow: { ...flow, section: { width: 2000, height: 1565 } }, image: { path: one.path } }, true)).error, /too small to read/);
    assert.match((await call('usability_import_figma_section', { flow: { ...flow, section: { width: 920, height: 300 } }, image: { path: one.path } }, true)).error, /does not match the section/);
    // Fallback 1: an exported section image, with detected screens confirmed by the owner.
    const proposal = await call('usability_import_figma_export', { sectionImage: one.path, name: 'Exported flow' });
    assert.equal(proposal.proposal.boxes.length, 3);
    for (const [i, [x, y]] of ([[40, 40], [480, 40], [40, 380]] as const).entries()) {
      const box = proposal.proposal.boxes[i];
      assert(Math.abs(box.x - x) <= 2 && Math.abs(box.y - y) <= 2 && Math.abs(box.width - 400) <= 3 && Math.abs(box.height - 300) <= 3, JSON.stringify(box));
    }
    const fromBoxes = await call('usability_import_figma_export', { sectionImage: one.path, name: 'Exported flow', boxes: proposal.proposal.boxes });
    assert.equal(fromBoxes.prototype.screens.length, 3);
    const withPlan = await call('usability_import_figma_export', { sectionImage: one.path, flow });
    assert.equal(withPlan.prototype.screens[0].target, 'owner-marked: Get started');
    // Fallback 2: a folder of frame PNGs exported from Figma.
    const { dir, manifest } = await renderPrototypeFixture();
    const folder = join(root, 'export'); await mkdir(folder);
    for (const [i, s] of manifest.screens.entries()) await copyFile((s.image as { path: string }).path, join(folder, `${i + 1} ${s.id}.png`));
    const order = await call('usability_import_figma_export', { folder });
    assert.deepEqual(order.proposal.order, ['1 welcome.png', '2 plan.png', '3 done.png']);
    const fromFolder = await call('usability_import_figma_export', { folder, order: order.proposal.order });
    assert.equal(fromFolder.prototype.screens.length, 3);
    assert.deepEqual(pngSize(await readFile(join(folder, '1 welcome.png'))), { width: 400, height: 300 });
    await rm(dir, { recursive: true, force: true });
  } finally { await client.close(); await server.close(); for (const d of [root, one.dir, two.dir, titled.dir]) await rm(d, { recursive: true, force: true }); }
});
